#!/usr/bin/env node
'use strict';
const {verifySession}=require('../recorder');
if(!process.argv[2]) {console.error('Usage: node tools/verify-session.js SESSION_FOLDER');process.exitCode=2;}
else {const result=verifySession(process.argv[2]);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;}
