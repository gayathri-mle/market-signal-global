import {loadData} from '../server/data.js';
import {answerQuestion} from '../server/chat.js';
import {send,body,rateLimit} from '../server/http.js';
export default async function handler(req,res){if(req.method!=='POST')return send(res,405,{error:'Use POST.'});if(rateLimit(req,res))return;try{const b=await body(req);if(typeof b.question!=='string'||b.question.length>1200||b.question.trim().length<3)return send(res,400,{error:'Enter a question between 3 and 1,200 characters.'});send(res,200,await answerQuestion(await loadData(),b.question));}catch{send(res,503,{error:'Your brief could not be completed. Please try again.'});}}
