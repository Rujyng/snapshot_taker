'use strict';
const path=require('node:path');
const os=require('node:os');
const {Recorder}=require('./recorder');

function createController(v, context, timers=globalThis) {
  let recorder, timer, starting=false, lastDir, marker=0;
  const status=v.window.createStatusBarItem(v.StatusBarAlignment.Left,10);
  context.subscriptions.push(status);
  function show(state, participant='') {
    status.text=state==='recording'?'$(record) Snapshots: '+participant:state==='error'?'$(error) Snapshots: ERROR':'$(circle-outline) Snapshots: Off';
    status.command=state==='recording'?'researchSnapshots.stop':'researchSnapshots.start';
    status.tooltip=state==='recording'?'Recording unsaved source edits. Click to stop.':state==='error'?'Recording stopped after an error. Check the error notification.':'Click to start local code recording.';
    status.show();
  }
  function fail(error) {
    if(timer!==undefined) timers.clearInterval(timer); timer=undefined;
    if(recorder) recorder.abort(error); recorder=undefined;
    show('error');
    void v.window.showErrorMessage('Code Snapshots recording stopped: '+error.message+'. Check the output folder and free disk space before starting again.');
  }
  function guard(fn) {
    if (!recorder) return;
    try { return fn(); } catch(e) { fail(e); }
  }
  function inside(file,folder) {
    const relative=path.relative(folder,file);
    return relative==='' || (!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
  }
  function eligible(doc) {
    if(doc.uri.scheme==='untitled') return true;
    return doc.uri.scheme==='file' && !!v.workspace.getWorkspaceFolder(doc.uri) && !inside(doc.uri.fsPath,recorder.dir);
  }
  function capture(doc, changes, reason) {
    if(eligible(doc)) return recorder.observe({uri:doc.uri.toString(),text:doc.getText(),language:doc.languageId,
      version:doc.version,dirty:doc.isDirty},changes,reason);
  }
  function rescan() {
    for(const doc of v.workspace.textDocuments) if(!doc.isClosed) capture(doc,undefined,'periodic_or_stop_rescan');
  }
  const position=p=>({line:p.line,character:p.character});
  const range=r=>({start:position(r.start),end:position(r.end)});
  function view(editor,reason) {
    if (!editor || !eligible(editor.document)) return;
    capture(editor.document,undefined,'view_rescan');
    recorder.event('editor_view',{uri:editor.document.uri.toString(),reason,
      visible_ranges:(editor.visibleRanges||[]).map(range),
      selections:(editor.selections||[]).map(s=>({anchor:position(s.anchor),active:position(s.active)}))});
  }
  async function start() {
    if (recorder||starting) return;
    starting=true;
    try {
      if(v.env.remoteName) throw Error('Use a local desktop VS Code window for this recorder');
      const folders=v.workspace.workspaceFolders||[];
      if(!folders.length || folders.some(f=>f.uri.scheme!=='file')) throw Error('Open the local experiment task folder in VS Code first');
      if(v.workspace.isTrusted===false) throw Error('Use a trusted experiment task folder');
      const participant=await v.window.showInputBox({title:'Code Snapshots: Participant ID',prompt:'Use an anonymous ID, for example P01.',
        validateInput:s=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s)?undefined:'Use 1–64 letters, numbers, underscores or hyphens; start with a letter or number.'});
      if(participant===undefined) return;
      const chosen=await v.window.showOpenDialog({title:'Choose where to store recordings (outside the task folder recommended)',
        canSelectFolders:true,canSelectFiles:false,canSelectMany:false,defaultUri:v.Uri.file(os.homedir()),openLabel:'Store recordings here'});
      if(!chosen?.length) return;
      if(chosen[0].scheme!=='file') throw Error('Choose a local output folder');
      recorder=new Recorder(chosen[0].fsPath,participant,{workspace:folders.map(f=>f.uri.toString())});
      lastDir=recorder.dir;marker=0;
      rescan();
      for(const editor of v.window.visibleTextEditors||[]) view(editor,'recording_start');
      recorder.event('window_focus',{focused:v.window.state?.focused??true});
      recorder.checkpoint('start');
      timer=timers.setInterval(()=>guard(()=>{rescan();recorder.checkpoint('interval');}),10000);
      show('recording',participant);
      void v.window.showInformationMessage('Code Snapshots recording '+participant+'. Output: '+lastDir);
    } catch(e) { fail(e); } finally { starting=false; }
  }
  function stop(reason='manual_stop') {
    if(!recorder) return;
    if(timer!==undefined) timers.clearInterval(timer); timer=undefined;
    try {
      rescan();recorder.stop(typeof reason==='string'?reason:'manual_stop');recorder=undefined;show('off');
      void v.window.showInformationMessage('Code Snapshots stopped. Keep the entire session folder: '+lastDir);
    } catch(e) {fail(e);}
  }
  function mark() {
    guard(()=>{
      const label='SYNC-'+String(++marker).padStart(3,'0');
      recorder.event('sync_marker',{label,note:'Command time; notification display onset must be established from video. Tobii clocks remain unaligned.'});
      void v.window.showInformationMessage('CODE SNAPSHOTS '+label+' — synchronization marker');
    });
  }
  for(const [id,fn] of Object.entries({start,stop,mark,openOutput:async()=>{
    if(lastDir) await v.commands.executeCommand('revealFileInOS',v.Uri.file(path.join(lastDir,'session.json')));
    else void v.window.showInformationMessage('Start a recording to create an output folder.');
  }})) context.subscriptions.push(v.commands.registerCommand('researchSnapshots.'+id,fn));

  const listen=(owner,event,fn)=>context.subscriptions.push(owner[event](data=>guard(()=>fn(data))));
  listen(v.workspace,'onDidOpenTextDocument',doc=>capture(doc,undefined,'document_opened'));
  listen(v.workspace,'onDidChangeTextDocument',e=>capture(e.document,e.contentChanges,
    e.reason===1?'undo':e.reason===2?'redo':'change'));
  listen(v.workspace,'onDidSaveTextDocument',doc=>{
    const id=capture(doc,undefined,'save_rescan');
    if(id) recorder.event('saved',{id,uri:doc.uri.toString(),version:doc.version});
  });
  listen(v.workspace,'onDidCloseTextDocument',doc=>recorder.close(doc.uri.toString()));
  listen(v.workspace,'onDidRenameFiles',e=>{
    for(const f of e.files) recorder.event('file_renamed',{old_uri:f.oldUri.toString(),new_uri:f.newUri.toString(),
      continuity:'Paths linked by VS Code rename event; buffer histories remain separate'});
  });
  listen(v.workspace,'onDidDeleteFiles',e=>{
    for(const uri of e.files) recorder.event('file_deleted',{uri:uri.toString(),note:'Earlier buffer text retained'});
  });
  listen(v.window,'onDidChangeActiveTextEditor',editor=>view(editor,'active_editor'));
  listen(v.window,'onDidChangeTextEditorSelection',e=>view(e.textEditor,'selection'));
  listen(v.window,'onDidChangeTextEditorVisibleRanges',e=>view(e.textEditor,'viewport'));
  listen(v.window,'onDidChangeWindowState',e=>recorder.event('window_focus',{focused:e.focused}));
  show('off');
  return {start,stop,mark,dispose:()=>stop('extension_deactivated')};
}
let controller;
function activate(context) {controller=createController(require('vscode'),context);return controller;}
function deactivate() {controller?.dispose();}
module.exports={activate,deactivate,createController};
