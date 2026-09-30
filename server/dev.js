import { spawn } from 'node:child_process';
const api=spawn(process.execPath,['server/index.js'],{stdio:'inherit',detached:process.platform!=='win32'});
const web=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit',detached:process.platform!=='win32'});
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;api.kill('SIGTERM');web.kill('SIGTERM');};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
for(const child of [api,web]) child.on('exit',code=>{if(code){stop();process.exitCode=code;}});
