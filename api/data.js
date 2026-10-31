import {loadData,queryData,opportunities} from '../server/data.js';
import {send} from '../server/http.js';
export default async function handler(req,res){if(req.method!=='GET')return send(res,405,{error:'Use GET.'});try{const p=new URL(req.url,'https://local').searchParams;const d=await loadData();res.setHeader('Cache-Control','public, s-maxage=180, stale-while-revalidate=300');send(res,200,p.get('section')==='opportunities'?{rows:opportunities(d),lastRunAt:d.lastRunAt}:queryData(d,p));}catch{send(res,503,{error:'Evidence is temporarily unavailable. Please try again.'});}}
