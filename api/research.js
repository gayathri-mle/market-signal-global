import {research} from '../server/data.js';
import {send,body,rateLimit} from '../server/http.js';
export default async function handler(req,res){if(req.method!=='POST')return send(res,405,{error:'Use POST.'});if(rateLimit(req,res))return;try{const b=await body(req);if(typeof b.query!=='string'||b.query.length>100)return send(res,400,{error:'Enter a search up to 100 characters.'});send(res,200,await research(b.query));}catch{send(res,503,{error:'Research could not be completed. Please try again.'});}}
