'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Recorder, verifySession } = require('../recorder');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  let elapsed = 0, wall = 1700000000000;
  const r = new Recorder(root, 'P01', {elapsed:()=>elapsed, wall:()=>wall});
  return {r, tick:(n=10000)=>{elapsed+=n;wall+=n;}, back:()=>{wall-=20000;}, root};
}
const doc = (uri, text, extra={}) => ({uri, text, language:'java', dirty:true, version:1, ...extra});
const read = p => fs.readFileSync(p, 'utf8');

test('empty baseline, incomplete unsaved changes, deletion and undo replay exactly', t=>{
  const {r,tick} = setup(t);
  r.observe(doc('file:///task/Main.java',''));
  r.observe(doc('file:///task/Main.java','if (x', {version:2}), [{rangeOffset:0,rangeLength:0,text:'if (x'}]);
  r.observe(doc('file:///task/Main.java','if (', {version:3}), [{rangeOffset:4,rangeLength:1,text:''}]);
  r.observe(doc('file:///task/Main.java','if (x', {version:4}), [{rangeOffset:4,rangeLength:0,text:'x'}], 'undo');
  tick(); r.checkpoint('interval'); r.stop();
  assert.equal(read(path.join(r.dir,'current/d0001.java')),'if (x');
  const events = read(path.join(r.dir,'events.jsonl')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(e=>e.type==='edit').map(e=>e.edits[0].deleted),['','x','']);
  assert.equal(events.find(e=>e.type==='baseline').text,'');
  assert.equal(verifySession(r.dir).ok,true);
});

test('multi-edit offsets use UTF-16 and preserve CRLF and punctuation',t=>{
  const {r} = setup(t);
  r.observe(doc('untitled:Untitled-1','😀a\r\nb;'));
  r.observe(doc('untitled:Untitled-1','😀X\r\nb()', {version:2}), [
    {rangeOffset:6,rangeLength:1,text:'()'}, {rangeOffset:2,rangeLength:1,text:'X'}
  ]);
  r.stop();
  assert.equal(read(path.join(r.dir,'current/d0001.java')),'😀X\r\nb()');
  assert.equal(verifySession(r.dir).ok,true);
});

test('missed changes become explicit resync; closing and deleting retain text',t=>{
  const {r} = setup(t);
  r.observe(doc('file:///a/Main.java','old'));
  r.observe(doc('file:///a/Main.java','new ???'), [{rangeOffset:99,rangeLength:0,text:'x'}]);
  r.observe(doc('file:///b/Main.java','separate'));
  r.close('file:///a/Main.java');
  r.event('file_deleted',{uri:'file:///a/Main.java'});
  r.stop();
  assert.equal(read(path.join(r.dir,'current/d0001.java')),'new ???');
  assert.equal(read(path.join(r.dir,'current/d0002.java')),'separate');
  const index = JSON.parse(read(path.join(r.dir,'documents.json')));
  assert.equal(index.documents[0].open,false);
  assert.match(read(path.join(r.dir,'events.jsonl')), /"type":"resync"/);
  assert.equal(verifySession(r.dir).ok,true);
});

test('monotonic elapsed time orders checkpoints despite wall-clock reversal',t=>{
  const {r,tick,back} = setup(t);
  r.observe(doc('untitled:one','a')); r.checkpoint('start');
  tick(); back(); r.checkpoint('interval'); r.stop();
  const rows=read(path.join(r.dir,'snapshots.jsonl')).trim().split('\n').map(JSON.parse);
  assert.equal(rows[1].elapsed_ms,10000);
  assert.ok(rows[1].unix_ms < rows[0].unix_ms);
  assert.equal(verifySession(r.dir).ok,true);
});

test('verifier rejects corrupted snapshots, missing events and truncated logs',t=>{
  const {r} = setup(t); r.observe(doc('untitled:one','x')); r.stop();
  const rows=read(path.join(r.dir,'snapshots.jsonl')).trim().split('\n').map(JSON.parse);
  const file=path.join(r.dir,rows[0].documents[0].snapshot);
  fs.writeFileSync(file,'wrong');
  assert.equal(verifySession(r.dir).ok,false);
  fs.writeFileSync(file,'x');
  fs.appendFileSync(path.join(r.dir,'events.jsonl'),'{"type":');
  assert.equal(verifySession(r.dir).ok,false);
});

test('session folders are unique and unsafe participant identifiers are refused',t=>{
  const {r,root} = setup(t);
  const second=new Recorder(root,'P01'); second.stop(); r.stop();
  assert.notEqual(r.dir,second.dir);
  assert.throws(()=>new Recorder(root,'../bad'), /participant/i);
});

test('verifier rejects duplicate IDs hiding a missing checkpoint document',t=>{
  const {r}=setup(t);
  r.observe(doc('untitled:one','a'));r.observe(doc('untitled:two','b'));r.stop();
  for(const name of ['events.jsonl','snapshots.jsonl']) {
    const file=path.join(r.dir,name);
    const events=read(file).trim().split('\n').map(JSON.parse);
    for(const e of events) if(e.type==='checkpoint') e.documents[1]={...e.documents[0]};
    fs.writeFileSync(file,events.map(e=>JSON.stringify(e)+'\n').join(''));
  }
  assert.equal(verifySession(r.dir).ok,false);
});
