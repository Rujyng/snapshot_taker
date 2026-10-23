'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createController}=require('../extension');
const {verifySession}=require('../recorder');

function harness(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'adapter-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const task=path.join(root,'task'),output=path.join(root,'output');
  fs.mkdirSync(task);fs.mkdirSync(output);
  const handlers={},commands={},messages=[];
  const uri=file=>({scheme:'file',fsPath:file,toString:()=> 'file://'+file});
  const on=name=>callback=>{handlers[name]=callback;return {dispose(){}};};
  let tick,cleared=false;
  const status={text:'',show(){},dispose(){}};
  const v={
    env:{},StatusBarAlignment:{Left:1},Uri:{file:uri},
    commands:{registerCommand:(name,fn)=>{commands[name]=fn;return {dispose(){}};},executeCommand:async()=>{}},
    workspace:{workspaceFolders:[{uri:uri(task)}],isTrusted:true,textDocuments:[],
      getWorkspaceFolder:u=>u.fsPath?.startsWith(task+path.sep)?{}:undefined,
      onDidOpenTextDocument:on('open'),onDidChangeTextDocument:on('change'),onDidSaveTextDocument:on('save'),
      onDidCloseTextDocument:on('close'),onDidRenameFiles:on('rename'),onDidDeleteFiles:on('delete')},
    window:{activeTextEditor:undefined,visibleTextEditors:[],state:{focused:true},
      createStatusBarItem:()=>status,showInputBox:async()=> 'P01',showOpenDialog:async()=>[uri(output)],
      showErrorMessage:async text=>{messages.push(text);},showInformationMessage:async text=>{messages.push(text);},
      onDidChangeActiveTextEditor:on('active'),onDidChangeTextEditorSelection:on('selection'),
      onDidChangeTextEditorVisibleRanges:on('viewport'),onDidChangeWindowState:on('focus')}
  };
  const c=createController(v,{subscriptions:[]},{setInterval:fn=>{tick=fn;return 123;},clearInterval:()=>{cleared=true;}});
  const makeDoc=(file,text)=>({uri:uri(file),languageId:'java',isDirty:true,version:1,getText:()=>text});
  return {v,c,root,task,output,handlers,commands,messages,status,makeDoc,tick:()=>tick(),cleared:()=>cleared};
}

test('adapter records unsaved buffers without saving sources; interval and stop are verifiable',async t=>{
  const h=harness(t),file=path.join(h.task,'Main.java');
  fs.writeFileSync(file,'saved');
  const d=h.makeDoc(file,'');h.v.workspace.textDocuments=[d];
  await h.c.start();
  d.getText=()=> 'public class {'; d.version++;
  h.handlers.change({document:d,contentChanges:[{rangeOffset:0,rangeLength:0,text:'public class {'}]});
  h.tick();
  await h.c.stop();
  const dir=path.join(h.output,fs.readdirSync(h.output)[0]);
  assert.equal(fs.readFileSync(path.join(dir,'current/d0001.java'),'utf8'),'public class {');
  assert.equal(fs.readFileSync(file,'utf8'),'saved');
  assert.equal(verifySession(dir).ok,true);
  assert.equal(h.cleared(),true);
  assert.match(h.status.text,/Off/);
});

test('scope excludes output and outside files, preserves closed code, and records manual sync and rename',async t=>{
  const h=harness(t),d=h.makeDoc(path.join(h.task,'Main.java'),'unfinished(');
  h.v.workspace.textDocuments=[d,h.makeDoc(path.join(h.root,'private.java'),'outside')];
  await h.c.start();
  const dir=path.join(h.output,fs.readdirSync(h.output)[0]);
  h.handlers.open(h.makeDoc(path.join(dir,'current/d0001.java'),'own output'));
  h.c.mark();
  h.handlers.rename({files:[{oldUri:d.uri,newUri:h.v.Uri.file(path.join(h.task,'New.java'))}]});
  h.handlers.close(d);h.v.workspace.textDocuments=[];
  h.tick();await h.c.stop();
  const result=verifySession(dir);
  assert.deepEqual([result.ok,result.documents],[true,1]);
  const text=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8');
  assert.match(text,/"type":"sync_marker"/);assert.match(text,/"type":"file_renamed"/);
  assert.equal(fs.readFileSync(path.join(dir,'current/d0001.java'),'utf8'),'unfinished(');
});

test('cancel leaves no session; missing workspace and remote hosts give actionable errors',async t=>{
  const h=harness(t);h.v.window.showInputBox=async()=>undefined;
  await h.c.start();assert.deepEqual(fs.readdirSync(h.output),[]);
  h.v.workspace.workspaceFolders=[];await h.c.start();assert.match(h.messages.at(-1),/folder/i);
  h.v.env.remoteName='wsl';await h.c.start();assert.match(h.messages.at(-1),/local/i);
});

test('an output write failure visibly stops recording instead of dropping edits silently',async t=>{
  const h=harness(t),d=h.makeDoc(path.join(h.task,'Main.java'),'one');
  h.v.workspace.textDocuments=[d];await h.c.start();
  const dir=path.join(h.output,fs.readdirSync(h.output)[0]);
  fs.rmSync(path.join(dir,'current'),{recursive:true});
  d.getText=()=> 'two';d.version++;
  h.handlers.change({document:d,contentChanges:[{rangeOffset:0,rangeLength:3,text:'two'}]});
  assert.match(h.status.text,/ERROR/);
  assert.match(h.messages.at(-1),/stopped/i);
  assert.equal(h.cleared(),true);
  assert.equal(verifySession(dir).ok,false);
});
