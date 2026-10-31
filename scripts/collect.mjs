import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const EMA_URL='https://www.ema.europa.eu/en/documents/report/medicines-output-medicines_json-report_en.json';
export const FDA_BASE='https://api.fda.gov/drug/drugsfda.json';
export const CMS_META='https://data.medicaid.gov/api/1/metastore/schemas/dataset/items/fbb83258-11c7-47f5-8b18-5f8e79f7e704';
export const CTG_BASE='https://clinicaltrials.gov/api/v2/studies';
export const asText=v=>Array.isArray(v)?v.join('; '):String(v??'');
export function dateISO(v){if(!v)return null;if(/^\d{8}$/.test(v))return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6)}`;const m=String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;}
const clean=s=>asText(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function normaliseEMA(payload){
 const list=Array.isArray(payload)?payload:payload.data;
 if(!Array.isArray(list))throw Error('Unexpected EMA format');
 return list.filter(r=>String(r.category).toLowerCase()==='human').map(r=>({id:`EMA:${r.ema_product_number}`,name:clean(r.name_of_medicine),molecule:clean(r.international_non_proprietary_name_common_name||r.active_substance),company:clean(r.marketing_authorisation_developer_applicant_holder),therapy:clean(r.therapeutic_area_mesh||r.pharmacotherapeutic_group_human)||'Not specified',region:'European Union',status:clean(r.medicine_status)||'Not specified',date:dateISO(r.last_updated_date),authorisationDate:dateISO(r.marketing_authorisation_date),source:'EMA',url:r.medicine_url,kind:'Medicine record'})).filter(r=>r.name&&r.url?.startsWith('https://www.ema.europa.eu/'));
}
export function normaliseFDA(payload,today){
 if(!Array.isArray(payload.results))throw Error('Unexpected FDA format');
 const products=[],events=[];
 for(const r of payload.results){
  const names=[...new Set((r.products||[]).map(p=>p.brand_name).filter(Boolean))];
  const molecule=[...new Set((r.products||[]).flatMap(p=>(p.active_ingredients||[]).map(a=>a.name)))].join('; ');
  const id=`FDA:${r.application_number}`;const url=`https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${String(r.application_number).replace(/\D/g,'')}`;
  const subs=(r.submissions||[]).filter(s=>s.submission_status==='AP'&&dateISO(s.submission_status_date)&&dateISO(s.submission_status_date)<=today).sort((a,b)=>b.submission_status_date.localeCompare(a.submission_status_date));
  if(!subs.length)continue;
  products.push({id,name:names.slice(0,3).join(' / ')||r.application_number,molecule,company:r.sponsor_name||'Not specified',therapy:'See product dossier',region:'United States',status:'Approved application record',date:dateISO(subs[0].submission_status_date),authorisationDate:dateISO(subs.find(s=>s.submission_type==='ORIG')?.submission_status_date),source:'FDA',url,kind:'Application record'});
  for(const s of subs.filter(s=>dateISO(s.submission_status_date)>=`${Number(today.slice(0,4))-1}-01-01`))events.push({id:`${id}:${s.submission_type}:${s.submission_number}`,productId:id,title:`${names[0]||r.application_number}: ${s.submission_type==='ORIG'?'original application approval':'supplemental approval decision'}`,product:names[0]||r.application_number,company:r.sponsor_name||'Not specified',category:'Regulatory',region:'United States',date:dateISO(s.submission_status_date),source:'FDA',url,fact:`FDA records an approved ${s.submission_type==='ORIG'?'original application':'supplemental submission'}${s.submission_class_code_description?' ('+s.submission_class_code_description+')':''}. This is a US regulatory record, not confirmation of a commercial launch.`,implication:'Review the dossier, affected market, and commercial announcement before assessing competitive impact.',verification:'Regulatory record'});
 }
 return {products,events};
}
export function normaliseTrials(payload){
 if(!Array.isArray(payload.studies))throw Error('Unexpected trial format');
 return payload.studies.map(({protocolSection:p,hasResults})=>{
 const i=p.identificationModule||{},s=p.statusModule||{},d=p.designModule||{},a=p.armsInterventionsModule||{};
 const drugs=(a.interventions||[]).filter(v=>['DRUG','BIOLOGICAL'].includes(v.type));
 return {id:i.nctId,title:clean(i.briefTitle),company:p.sponsorCollaboratorsModule?.leadSponsor?.name||'Not specified',products:drugs.map(v=>v.name),conditions:p.conditionsModule?.conditions||[],status:s.overallStatus||'Not specified',phase:(d.phases||[]).join(' / ')||'Not specified',date:s.lastUpdatePostDateStruct?.date||null,completion:s.primaryCompletionDateStruct?.date||null,completionType:s.primaryCompletionDateStruct?.type||null,countries:[...new Set((p.contactsLocationsModule?.locations||[]).map(v=>v.country).filter(Boolean))],hasResults:Boolean(hasResults),url:`https://clinicaltrials.gov/study/${i.nctId}`};
 }).filter(r=>r.id&&r.products.length);
}
export function parseCSV(s){
 const rows=[];let row=[],v='',quoted=false;
 for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='"'){if(quoted&&s[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(v);v='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(v);if(row.some(Boolean))rows.push(row);row=[];v='';}else v+=ch;}
 if(v||row.length){row.push(v);rows.push(row);}return rows;
}
export function normalisePrices(text){
 const [headers,...records]=parseCSV(text.replace(/^\uFEFF/,''));if(!headers)throw Error('No pricing data');
 const norm=k=>k.toLowerCase().replace(/[^a-z0-9]/g,'');const idx=name=>headers.findIndex(h=>norm(h)===norm(name));
 const at=(r,name)=>r[idx(name)]||'';const latest=new Map();
 const usDate=v=>{const m=v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:dateISO(v);};
 for(const r of records){const ndc=at(r,'NDC'),amount=Number(at(r,'NADAC Per Unit'));if(!ndc||!Number.isFinite(amount)||amount<=0)continue;
 const rec={id:`NADAC:${ndc}`,ndc,name:at(r,'NDC Description'),amount,currency:'USD',unit:at(r,'Pricing Unit'),effectiveDate:usDate(at(r,'Effective Date')),asOf:usDate(at(r,'As of Date')),region:'United States',basis:'NADAC pharmacy acquisition benchmark per unit',source:'CMS Medicaid',url:'https://data.medicaid.gov/dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704'};
 const previous=latest.get(ndc);if(!previous||(rec.asOf||'')>(previous.asOf||''))latest.set(ndc,rec);
 }
 if(latest.size<1)throw Error('Unrecognised pricing columns');return [...latest.values()];
}
export function normaliseNews(xml,company,host,today){
 const decode=s=>clean(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
 const field=(s,tag)=>decode(s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`,'i'))?.[1]||'');
 return [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map(([,s])=>{const title=field(s,'title'),url=field(s,'link'),d=new Date(field(s,'pubDate'));let category=/\blaunch(?:es|ed|ing)?\b|commercially available/i.test(title)?'Launch announcement':/clinical|phase [123iv]+|trial|study|endpoint/i.test(title)?'Clinical announcement':'Company announcement';return {id:`NEWS:${url}`,title,company,product:company,category,region:'See announcement',date:Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10),source:company,url,fact:'Company-reported announcement. Read the source for the product, market, and full conditions.',implication:'Assess the relevant indication, market access, and competitive positioning before acting.',verification:'Company-reported'};}).filter(r=>{try{return new URL(r.url).hostname===host&&r.title&&r.date&&r.date<=today;}catch{return false;}}).slice(0,30);
}
export function detectChanges(previous,current,now){
 if(!previous.lastRunAt)return [];
 const events=[];
 for(const section of ['products','trials','prices','news']){
  const old=new Map((previous[section]||[]).map(r=>[r.id,r]));
  for(const row of current[section]||[]){const before=old.get(row.id);const fields=section==='products'?['status','date']:section==='trials'?['status','phase','completion','hasResults']:section==='prices'?['amount','effectiveDate']:['title','date'];
   if(!before){events.push({id:`${now}:${row.id}`,recordId:row.id,title:`Newly observed ${section==='products'?'product record':section==='trials'?'trial record':'pricing record'}`,name:row.name||row.title,category:section,date:now.slice(0,10),observedAt:now,note:'New to the monitored snapshot. This does not establish a new launch or event date.',url:row.url});continue;}
   const changed=fields.filter(f=>JSON.stringify(before[f])!==JSON.stringify(row[f]));
   if(changed.length)events.push({id:`${now}:${row.id}`,recordId:row.id,title:`${section==='prices'?'Pricing benchmark':'Record'} changed`,name:row.name||row.title,category:section,date:now.slice(0,10),observedAt:now,note:changed.map(f=>`${f}: ${before[f]??'not specified'} → ${row[f]??'not specified'}`).join('; '),url:row.url});
  }
 }
 return events.slice(0,200);
}
async function get(url,type='json'){
 const r=await fetch(url,{headers:{'User-Agent':'MarketSignal/1.0 (public-source research)','Accept':type==='json'?'application/json':'text/csv'},signal:AbortSignal.timeout(55000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return type==='json'?r.json():r.text();
}
export async function collect({fetcher=get,path='dist/data/latest.json'}={}){
 let previous={};try{previous=JSON.parse(await readFile(path,'utf8'));}catch{}
 const now=new Date().toISOString(),today=now.slice(0,10);const start=new Date(Date.now()-180*86400000).toISOString().slice(0,10).replaceAll('-','');
 const current={schemaVersion:2,focus:'Global / All therapy areas',baselineAt:previous.baselineAt||now,lastRunAt:now,lastSuccessfulRunAt:previous.lastSuccessfulRunAt||null,monitoring:{cadence:'Daily',scheduledTime:'08:17 IST'},products:previous.products||[],trials:previous.trials||[],prices:previous.prices||[],events:previous.events||[],news:previous.news||[],sourceChecks:[],changes:[],coverage:{geographies:['United States','European Union','Global clinical trials'],note:'All therapy areas. Selected public sources, not every product or jurisdiction. Regulatory approvals and record updates are not commercial launches. Pricing coverage is a US acquisition benchmark, not global net pricing.'}};
 const run=async(id,name,url,job,coverage)=>{const before=previous.sourceChecks?.find(x=>x.id===id);try{const counts=await job();current.sourceChecks.push({id,name,url,status:'current',checkedAt:now,lastSuccessAt:now,coverage,...counts});}catch(error){current.sourceChecks.push({id,name,url,status:'unavailable',checkedAt:now,lastSuccessAt:before?.lastSuccessAt||null,coverage,detail:`Source could not be refreshed (${error.message}). Last known records are retained.`});}};
 await Promise.all([
 run('ema','European Medicines Agency',EMA_URL,async()=>{const p=await fetcher(EMA_URL);const rows=normaliseEMA(p);if(!rows.length)throw Error('No medicine records');current.products=[...current.products.filter(p=>p.source!=='EMA'),...rows];return {records:current.products.filter(p=>p.source==='EMA').length};},'Human medicine pages in the centralised procedure. Includes non-authorised statuses. Not all nationally authorised EU medicines.'),
 run('fda','US Food and Drug Administration',FDA_BASE,async()=>{let all=[];let total=0;for(let skip=0;skip<300;skip+=100){const url=`${FDA_BASE}?search=submissions.submission_status_date:[${start}+TO+${today.replaceAll('-','')}]&sort=submissions.submission_status_date:desc&limit=100&skip=${skip}`;const p=await fetcher(url);all.push(...p.results||[]);total=p.meta?.results?.total||0;if(all.length>=total)break;}const parsed=normaliseFDA({results:all},today);if(!parsed.products.length)throw Error('No application records');current.products=[...current.products.filter(p=>p.source!=='FDA'),...parsed.products];current.events=parsed.events.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,300);return {records:parsed.products.length,sourceTotal:total,truncated:all.length<total};},'Up to 300 recently updated application records in a rolling 180-day query. Parsed decisions are dated and classified separately.'),
 run('ctg','ClinicalTrials.gov',CTG_BASE,async()=>{let all=[];let token;let total=0;for(let i=0;i<2;i++){const url=`${CTG_BASE}?format=json&filter.advanced=${encodeURIComponent('AREA[StudyType]INTERVENTIONAL AND (AREA[InterventionType]DRUG OR AREA[InterventionType]BIOLOGICAL)')}&sort=LastUpdatePostDate:desc&pageSize=100&countTotal=true${token?'&pageToken='+encodeURIComponent(token):''}`;const p=await fetcher(url);all.push(...p.studies||[]);total=p.totalCount||total;token=p.nextPageToken;if(!token)break;}const rows=normaliseTrials({studies:all});if(!rows.length)throw Error('No trial records');current.trials=rows;return {records:current.trials.length,sourceTotal:total,truncated:Boolean(token)};},'Up to 200 recently updated drug/biological interventional study records. Registry status is not a regulatory decision or proof of efficacy.'),
 run('cms','CMS Medicaid NADAC',CMS_META,async()=>{const meta=await fetcher(CMS_META);const url=meta.distribution?.find(x=>x.downloadURL?.startsWith('https://download.medicaid.gov/')&&x.format?.toLowerCase()==='csv')?.downloadURL;if(!url)throw Error('No recognised official CSV');current.prices=normalisePrices(await fetcher(url,'text'));return {records:current.prices.length,datasetUpdated:meta.modified,downloadUrl:url};},'Latest published 2026 weekly US retail-community-pharmacy acquisition benchmark. Currency USD. EA, ML and GM units must not be mixed.'),
 ...[{id:'gsk',company:'GSK',url:'https://www.gsk.com/en-gb/media/rss/',host:'www.gsk.com'},{id:'lilly',company:'Eli Lilly',url:'https://investor.lilly.com/rss/news-releases.xml?items=10',host:'investor.lilly.com'}].map(feed=>run(feed.id,feed.company+' announcements',feed.url,async()=>{const rows=normaliseNews(await fetcher(feed.url,'text'),feed.company,feed.host,today);if(!rows.length)throw Error('No recognised announcements');current.news=[...current.news.filter(r=>r.source!==feed.company),...rows];return {records:rows.length};},'Recent official company headlines across therapy areas. Company-reported claims require review. Coverage is limited to this feed.'))
 ]);
 // A limited snapshot should never silently replace prior data with an empty result.
 current.products=[...new Map(current.products.map(r=>[r.id,r])).values()];
 if(current.sourceChecks.some(s=>s.status==='current'))current.lastSuccessfulRunAt=now;
 current.sourceChecks.sort((a,b)=>['ema','fda','ctg','cms','gsk','lilly'].indexOf(a.id)-['ema','fda','ctg','cms','gsk','lilly'].indexOf(b.id));
 current.monitoring.status=current.sourceChecks.every(s=>s.status==='current')?'Current':'Partial coverage';
 current.changes=[...detectChanges(previous,current,now),...(previous.changes||[])].slice(0,400);
 current.events=[...new Map([...current.events.filter(r=>r.source==='FDA'),...current.news,...current.products.filter(p=>p.source==='EMA'&&p.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(p=>({id:`${p.id}:${p.date}`,productId:p.id,title:`${p.name}: medicine record updated`,product:p.name,company:p.company,category:'Regulatory',region:p.region,date:p.date,source:'EMA',url:p.url,fact:`EMA lists the medicine status as ${p.status}. The date shown is a record update, not necessarily a new authorisation or launch.`,implication:'Review the actual procedure and market status before inferring a competitive event.',verification:'Medicine record'}))].map(r=>[r.id,r])).values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 await writeFile(path,JSON.stringify(current)+'\n');
 console.log(JSON.stringify({products:current.products.length,trials:current.trials.length,prices:current.prices.length,sources:current.sourceChecks.map(s=>({name:s.name,status:s.status,records:s.records,detail:s.detail}))}));
 if(!current.sourceChecks.some(s=>s.status==='current'))throw Error('All sources failed; retained previous records.');
 return current;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)collect().catch(e=>{console.error(e.message);process.exitCode=1;});
