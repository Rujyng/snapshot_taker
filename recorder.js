'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');

const hash = text => crypto.createHash('sha256').update(text,'utf8').digest('hex');
function atomic(file, text) {
  const temp=file+'.tmp';
  fs.writeFileSync(temp,text,'utf8');
  fs.renameSync(temp,file);
}
function json(file, value) { atomic(file,JSON.stringify(value,null,2)+'\n'); }
function publicDoc(d) { const {text,...meta}=d; return meta; }
function extension(doc) {
  const match=/\.([a-zA-Z0-9]{1,12})$/.exec(doc.uri);
  return match ? match[1] : ({java:'java',python:'py',c:'c',cpp:'cpp',csharp:'cs',javascript:'js',typescript:'ts'}[doc.language] || 'txt');
}
function applyEdits(before, edits) {
  let result=before, boundary=before.length;
  for (const edit of edits) {
    const {offset,length,text}=edit;
    if (!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<0||offset+length>boundary||typeof text!=='string') throw Error('Invalid or overlapping edit');
    if (edit.deleted!==undefined && before.slice(offset,offset+length)!==edit.deleted) throw Error('Deleted text mismatch');
    result=result.slice(0,offset)+text+result.slice(offset+length);
    boundary=offset;
  }
  return result;
}

class Recorder {
  constructor(root, participant, options={}) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(participant)) throw Error('Invalid participant ID');
    this.wall=options.wall || Date.now;
    const start=performance.now();
    this.elapsed=options.elapsed || (()=>performance.now()-start);
    fs.mkdirSync(root,{recursive:true});
    const stamp=new Date(this.wall()).toISOString().replace(/[:.]/g,'-');
    this.dir=fs.mkdtempSync(path.join(root,participant+'_'+stamp+'_'));
    for (const folder of ['baselines','current','snapshots']) fs.mkdirSync(path.join(this.dir,folder));
    fs.writeFileSync(path.join(this.dir,'events.jsonl'),'');
    fs.writeFileSync(path.join(this.dir,'snapshots.jsonl'),'');
    this.docs=new Map(); this.seq=0; this.checkpoints=0; this.stopped=false;
    this.session={schema:1,tool:'Research Code Snapshots',tool_version:'1.0.0',participant,
      status:'recording',interval_ms:10000,encoding:'UTF-8 editor text',
      clocks:{wall:'UTC / Unix milliseconds from computer clock',elapsed:'monotonic milliseconds since recorder start',tobii_alignment:'unestablished'},
      workspace:options.workspace||[],scope:'Open task-workspace file documents and untitled documents; unopened files excluded'};
    this.event('start',{participant}); this.writeMetadata();
  }
  event(type, data={}) {
    if (this.stopped) throw Error('Recording has stopped');
    const event={...data,seq:++this.seq,type,unix_ms:this.wall(),elapsed_ms:Number(this.elapsed().toFixed(3))};
    event.utc=new Date(event.unix_ms).toISOString();
    fs.appendFileSync(path.join(this.dir,'events.jsonl'),JSON.stringify(event)+'\n');
    return event;
  }
  observe(input, changes, reason='change') {
    let d=this.docs.get(input.uri);
    const meta={uri:input.uri,language:input.language,dirty:input.dirty,version:input.version,open:true};
    if (!d) {
      const id='d'+String(this.docs.size+1).padStart(4,'0');
      const filename=id+'.'+extension(input);
      const event=this.event('baseline',{id,...meta,text:input.text,sha256:hash(input.text),evidence:'direct_editor_buffer'});
      d={id,filename,...meta,text:input.text,sha256:event.sha256,last_edit_seq:event.seq,last_observed:event};
      this.docs.set(input.uri,d);
      atomic(path.join(this.dir,'baselines',filename),d.text);
      atomic(path.join(this.dir,'current',filename),d.text);
    } else {
      if (input.text!==d.text) {
        let edits, supported=false;
        try {
          edits=(changes||[]).map(c=>({offset:c.rangeOffset,length:c.rangeLength,text:c.text,deleted:d.text.slice(c.rangeOffset,c.rangeOffset+c.rangeLength)})).sort((a,b)=>b.offset-a.offset);
          supported=edits.length>0 && applyEdits(d.text,edits)===input.text;
        } catch (_) { /* The exact post-event buffer is retained as a resync below. */ }
        const event=this.event(supported?'edit':'resync', {id:d.id,...meta,reason,
          before_sha256:d.sha256,sha256:hash(input.text),
          ...(supported?{edits}:{text:input.text,explanation:'Incremental delta unavailable or inconsistent; direct buffer recapture'})});
        d.text=input.text; d.sha256=event.sha256; d.last_edit_seq=event.seq;
        atomic(path.join(this.dir,'current',d.filename),d.text);
      } else if (d.version!==input.version || d.dirty!==input.dirty || !d.open) {
        this.event('document_state',{id:d.id,...meta});
      }
      Object.assign(d,meta);
    }
    d.last_observed={unix_ms:this.wall(),elapsed_ms:Number(this.elapsed().toFixed(3)),version:input.version};
    return d.id;
  }
  close(uri) {
    const d=this.docs.get(uri);
    if (d) { d.open=false; this.event('document_closed',{id:d.id,uri}); }
  }
  checkpoint(reason) {
    const number=++this.checkpoints;
    const folder='snapshots/'+String(number).padStart(6,'0');
    fs.mkdirSync(path.join(this.dir,folder));
    const documents=[...this.docs.values()].map(d=>{
      const snapshot=folder+'/'+d.filename;
      atomic(path.join(this.dir,snapshot),d.text);
      return {...publicDoc(d),snapshot,
        verification:d.open?'direct_editor_buffer_last_observed':'carried_forward_closed_buffer',
        changed_since_previous_checkpoint:d.last_edit_seq>(this.previousCheckpointSeq||0)};
    });
    const event=this.event('checkpoint',{number,reason,documents});
    fs.appendFileSync(path.join(this.dir,'snapshots.jsonl'),JSON.stringify(event)+'\n');
    this.previousCheckpointSeq=event.seq;
    this.writeMetadata();
    for (const file of ['events.jsonl','snapshots.jsonl']) {
      const fd=fs.openSync(path.join(this.dir,file),'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    return event;
  }
  writeMetadata() {
    json(path.join(this.dir,'session.json'),{...this.session,event_count:this.seq,checkpoint_count:this.checkpoints});
    json(path.join(this.dir,'documents.json'),{schema:1,documents:[...this.docs.values()].map(publicDoc)});
  }
  stop(reason='manual_stop') {
    if (this.stopped) return;
    this.checkpoint('stop');
    const event=this.event('stop',{reason});
    this.session.status='complete'; this.session.stopped=event;
    this.writeMetadata(); this.stopped=true;
  }
  abort(error) {
    if (this.stopped) return;
    try { this.event('error',{message:String(error.message||error)}); } catch (_) {}
    this.session.status='error'; this.session.error=String(error.message||error);
    try { this.writeMetadata(); } catch (_) {}
    this.stopped=true;
  }
}

function verifySession(dir) {
  try {
    function local(relative) {
      const file=path.resolve(dir,relative), root=path.resolve(dir)+path.sep;
      if (!file.startsWith(root)) throw Error('Unsafe output path');
      return file;
    }
    function rows(name) {
      const text=fs.readFileSync(local(name),'utf8');
      if (!text.endsWith('\n')) throw Error(name+' has an incomplete final record');
      return text.trimEnd().split('\n').filter(Boolean).map(JSON.parse);
    }
    function checkFile(file, expected) {
      if (hash(fs.readFileSync(local(file),'utf8'))!==expected) throw Error('Hash mismatch: '+file);
    }
    const session=JSON.parse(fs.readFileSync(local('session.json'),'utf8'));
    const events=rows('events.jsonl'), snapshots=rows('snapshots.jsonl');
    const states=new Map(); let seq=0, elapsed=-Infinity, checkpoints=0;
    for (const e of events) {
      if (e.seq!==++seq || e.elapsed_ms<elapsed) throw Error('Missing, reordered, or invalid event');
      elapsed=e.elapsed_ms;
      if (e.type==='baseline') {
        if (states.has(e.id)) throw Error('Duplicate baseline');
        states.set(e.id,e.text);
        const index=JSON.parse(fs.readFileSync(local('documents.json'),'utf8')).documents.find(d=>d.id===e.id);
        if (!index) throw Error('Missing document index');
        checkFile('baselines/'+index.filename,e.sha256);
      } else if (e.type==='edit'||e.type==='resync') {
        if (!states.has(e.id)||hash(states.get(e.id))!==e.before_sha256) throw Error('Before-state mismatch');
        states.set(e.id,e.type==='edit'?applyEdits(states.get(e.id),e.edits):e.text);
      }
      if (['baseline','edit','resync'].includes(e.type) && hash(states.get(e.id))!==e.sha256) throw Error('Replayed state mismatch');
      if (e.type==='checkpoint') {
        if (JSON.stringify(e)!==JSON.stringify(snapshots[checkpoints++])) throw Error('Checkpoint manifest mismatch');
        if (e.documents.length!==states.size) throw Error('Checkpoint document count mismatch');
        const ids=new Set(e.documents.map(d=>d.id));
        const paths=new Set(e.documents.map(d=>d.snapshot));
        if (ids.size!==states.size || paths.size!==states.size || [...states.keys()].some(id=>!ids.has(id))) throw Error('Checkpoint has duplicate or missing documents');
        for (const d of e.documents) {
          if (!states.has(d.id)||hash(states.get(d.id))!==d.sha256) throw Error('Checkpoint replay mismatch');
          checkFile(d.snapshot,d.sha256);
        }
      }
    }
    if (checkpoints!==snapshots.length||seq!==session.event_count) throw Error('Manifest count mismatch');
    if (session.status!=='complete'||events.at(-1)?.type!=='stop') throw Error('Session was interrupted or has not stopped');
    const index=JSON.parse(fs.readFileSync(local('documents.json'),'utf8'));
    if (index.documents.length!==states.size) throw Error('Current index mismatch');
    for (const d of index.documents) {
      if (hash(states.get(d.id))!==d.sha256) throw Error('Current replay mismatch');
      checkFile('current/'+d.filename,d.sha256);
    }
    return {ok:true,events:seq,documents:states.size,checkpoints};
  } catch (e) { return {ok:false,error:e.message}; }
}
module.exports={Recorder,verifySession};
