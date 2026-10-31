export const DEFAULT_MODEL='openai/gpt-oss-20b';
export class ModelError extends Error{constructor(code,message){super(message);this.code=code;}}
export async function completeJSON(messages,{apiKey,model=DEFAULT_MODEL,fetchImpl=fetch,maxTokens=900}={}){
 if(!apiKey)throw new ModelError('not_configured','The model API key is not configured.');
 let response;
 try{response=await fetchImpl('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,response_format:{type:'json_object'},temperature:0.2,reasoning_effort:'low',max_completion_tokens:maxTokens}),signal:AbortSignal.timeout(20000)});}catch{throw new ModelError('connection','The model service could not be reached.');}
 if(!response.ok){const code=response.status===429?'rate_limited':response.status===401||response.status===403?'authentication':'provider_error';throw new ModelError(code,code==='rate_limited'?'The model provider’s free allowance is temporarily exhausted.':'The model service could not complete this request.');}
 let data;
 try{data=await response.json();}catch{throw new ModelError('invalid_response','The model returned an invalid response.');}
 const choice=data.choices?.[0];
 if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')throw new ModelError('invalid_response','The model response was incomplete.');
 try{return {value:JSON.parse(choice.message.content),model:data.model||model};}catch{throw new ModelError('invalid_response','The model response was not valid JSON.');}
}
