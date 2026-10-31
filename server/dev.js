import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import data from '../api/data.js';import chat from '../api/chat.js';import research from '../api/research.js';
const handlers={'/api/data':data,'/api/chat':chat,'/api/research':research};
http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');if(handlers[url.pathname])return handlers[url.pathname](req,res);const name=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=path.resolve('dist',name);if(!file.startsWith(path.resolve('dist')+path.sep)||name.startsWith('data/')){res.writeHead(404);return res.end();}try{const bytes=await readFile(file);res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(bytes);}catch{res.writeHead(404);res.end('Not found');}}).listen(process.env.PORT||4175,'127.0.0.1',()=>console.log('MarketSignal on http://127.0.0.1:4175'));
