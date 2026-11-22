'use strict';
const CONFIG={"owner": "IvanHughyifanhu", "ownerId": 199221372, "repository": "log-private", "branch": "main", "basePath": "/log/", "origin": "https://ivanhughyifanhu.github.io", "revision": "1e28f6dee12cf2226ab5612e94e8f5f2fc7c14b3", "authMode": "github-oauth-v1", "repositoryId": 1465610041, "clientId": "Iv23liGTfG85bzFWYTzV", "relay": "https://log-login-ivanhughyifanhu.netlify.app/.netlify/functions/github-login"};
// Pure data rules used by the prototype and its tests.
const SCHEMA = 'journal-events-v1';
const DAY = 86400000;
// Monetary values are integer fen. Revisions replace the displayed head, never add to it.
function parseAmountMinor(value){
  const text=String(value).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('金额请填写大于0的数字，最多两位小数');
  const [whole,fraction='']=text.split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(minor)||minor<=0)throw new Error('金额需大于0且在可记账范围内');return minor;
}
function moneyLabel(minor,sign='auto'){
  if(!Number.isSafeInteger(minor))throw new Error('金额超出可记账范围');
  const n=Math.abs(minor),digits=Math.floor(n/100).toLocaleString('en-US')+'.'+String(n%100).padStart(2,'0');
  return (minor<0||sign==='expense'?'-':minor>0||sign==='income'?'+':'')+digits;
}
function financeSignedMinor(finance){return finance.direction==='expense'?-finance.amountMinor:finance.amountMinor;}
function financeTone(minor){return minor>0?'income':minor<0?'expense':'neutral';}
function matchesRecordType(record,type){return !type||record.heads.some(h=>(h.data.type==='artifact'?'note':h.data.type)===type);}
function recordProjectIds(data={}){
  return [...new Set((Array.isArray(data.projectIds)?data.projectIds:[data.projectId]).filter(id=>typeof id==='string'&&id))];
}
function recordInProject(data,id){return !id||recordProjectIds(data).includes(id);}
function recordMatchesRange(record,range){return record.heads.some(h=>(record.conflict||!h.data.archived)&&h.data.date>=range.start&&h.data.date<=range.end);}
function withRecordProjects(data,ids){const projectIds=[...new Set(ids.filter(id=>typeof id==='string'&&id))];return {...data,projectId:projectIds[0]||'',projectIds};}
function summarizeFinance(events,date,projectId=''){
  const range=typeof date==='string'?{start:date,end:date}:date;dayWindow(range.start);dayWindow(range.end);let incomeMinor=0,expenseMinor=0;
  for(const r of materialize(events)){if(r.conflict||r.data.archived||r.data.type!=='finance'||(r.data.date<range.start||r.data.date>range.end)||!recordInProject(r.data,projectId))continue;
    const f=r.data.finance;if(f.direction==='income')incomeMinor+=f.amountMinor;else expenseMinor+=f.amountMinor;
    if(!Number.isSafeInteger(incomeMinor)||!Number.isSafeInteger(expenseMinor))throw new Error('汇总金额超出可记账范围');
  }return {incomeMinor,expenseMinor,netMinor:incomeMinor-expenseMinor};
}
function dayWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式无效');
  const start = Date.parse(date + 'T00:00:00+08:00');
  if (!Number.isFinite(start) || new Date(start + 8*3600000).toISOString().slice(0,10) !== date) throw new Error('日期不存在');
  return [start, start + DAY];
}
function mergeIntervals(intervals) {
  const sorted = intervals.filter(([a,b]) => b>a).map(x=>[...x]).sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for (const [a,b] of sorted) {
    const last=merged.at(-1);
    if (last && a<=last[1]) last[1]=Math.max(last[1],b); else merged.push([a,b]);
  }
  return merged;
}
function summarizeRuns(runs,date) {
  const [ds,de]=dayWindow(date), intervals=[], perRun=[];
  // Count execution leaves, not their coordinating parent a second time.
  const parentIds=new Set(runs.map(r=>r.parentId).filter(Boolean));
  let uncertain=0, inputTokens=0, outputTokens=0;
  const seen=new Set();
  for (const run of runs) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    if (parentIds.has(run.id)) continue;
    let pieces=[];
    for (const seg of run.segments || []) {
      const a=Date.parse(seg.start), b=Date.parse(seg.end || run.lastHeartbeat || '');
      if (!seg.end) uncertain++;
      if (!Number.isFinite(a)||!Number.isFinite(b)||b<a) continue;
      if (a<de && b>ds) pieces.push([Math.max(a,ds),Math.min(b,de)]);
    }
    pieces=mergeIntervals(pieces);
    // Token attribution requires timestamped usage events; never prorate a whole run.
    for (const u of run.usageEvents || []) {
      const t=Date.parse(u.at);
      if (t>=ds && t<de) {inputTokens+=u.inputTokens||0;outputTokens+=u.outputTokens||0;}
    }
    const ms=pieces.reduce((v,[a,b])=>v+b-a,0);
    if (!ms) continue;
    intervals.push(...pieces); perRun.push({id:run.id,name:run.name,ms,intervals:pieces});
  }
  const union=mergeIntervals(intervals), changes=[];
  intervals.forEach(([a,b])=>changes.push([a,1],[b,-1]));
  changes.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  let current=0,peak=0;
  for (const [,n] of changes) {current+=n;peak=Math.max(peak,current);}
  return {taskHours:perRun.reduce((s,r)=>s+r.ms,0)/3600000,coverageHours:union.reduce((s,[a,b])=>s+b-a,0)/3600000,peak,inputTokens,outputTokens,uncertain,perRun};
}
function validateEvents(events) {
  if (!Array.isArray(events) || events.length>100000) throw new Error('记录数量或格式无效');
  const ids=new Map();
  for (const e of events) {
    if (!e || typeof e.id!=='string' || !e.id || typeof e.recordId!=='string' || !e.recordId || !Array.isArray(e.parents) || !['create','revise','archive','restore','resolve'].includes(e.op) || !Number.isFinite(Date.parse(e.at))) throw new Error('事件格式无效');
    if (ids.has(e.id)) throw new Error('备份内有重复事件编号');
    if (!e.data || typeof e.data.text!=='string' || !e.data.text.trim() || e.data.text.length>20000 || typeof e.data.archived!=='boolean' || typeof e.data.projectId!=='string' || !['note','action','calendar','artifact','finance'].includes(e.data.type)) throw new Error('内容格式无效');
    if(e.data.projectIds!==undefined&&(!Array.isArray(e.data.projectIds)||e.data.projectIds.some(id=>typeof id!=='string'||!id)||new Set(e.data.projectIds).size!==e.data.projectIds.length||e.data.projectId!==(e.data.projectIds[0]||'')))throw new Error('项目关联格式无效');
    dayWindow(e.data.date);
    if(e.data.type==='finance'){const f=e.data.finance;if(!f||!['income','expense'].includes(f.direction)||f.currency!=='CNY'||!Number.isSafeInteger(f.amountMinor)||f.amountMinor<=0)throw new Error('财务金额或收支类型无效');}
    if(e.data.calendar!==undefined){
      const c=e.data.calendar;
      if(!c||!['event','deadline'].includes(c.kind)||typeof c.time!=='string'||(c.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time))||c.endTime!==undefined&&(typeof c.endTime!=='string'||c.endTime&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.endTime)||!c.time||c.endTime<=c.time))||c.location!==undefined&&(typeof c.location!=='string'||c.location.length>300))throw new Error('日程时间或地点格式无效');
    }
    ids.set(e.id,e);
  }
  const roots=new Map(),visiting=new Set(),visited=new Set();
  for (const e of events) {
    if (!e.parents.length) {
      if(e.op!=='create'||roots.has(e.recordId)) throw new Error('原始记录重复或缺少来源');
      roots.set(e.recordId,e.id);
    } else if(e.op==='create') throw new Error('原始记录不能有前序');
    for (const p of e.parents) if(!ids.has(p)||ids.get(p).recordId!==e.recordId) throw new Error('修改记录缺少同一记录的前序');
  }
  function visit(id) {if(visiting.has(id)) throw new Error('修改记录形成循环');if(visited.has(id))return;visiting.add(id);ids.get(id).parents.forEach(visit);visiting.delete(id);visited.add(id);}
  for (const e of events) {if(!roots.has(e.recordId)) throw new Error('缺少原文');visit(e.id);}
  return events;
}
function stableEventJSON(value){return JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(stableEventJSON(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stableEventJSON(value[k]))])):value);}
function mergeEvents(existing,incoming) {
  validateEvents(existing); validateEvents(incoming);
  const map=new Map(existing.map(e=>[e.id,e]));
  for(const e of incoming) {
    if(map.has(e.id) && stableEventJSON(map.get(e.id))!==stableEventJSON(e)) throw new Error('同一事件编号内容不同；保留本机数据，导入已停止');
    map.set(e.id,e);
  }
  return validateEvents([...map.values()]);
}
function materialize(events) {
  const groups=new Map();
  for(const e of events) {if(!groups.has(e.recordId))groups.set(e.recordId,[]);groups.get(e.recordId).push(e);}
  return [...groups.entries()].map(([id,list])=>{
    const used=new Set(list.flatMap(e=>e.parents));
    const heads=list.filter(e=>!used.has(e.id)).sort((a,b)=>a.id.localeCompare(b.id));
    const root=list.find(e=>e.op==='create');
    // Conflicting heads remain visible; no clock-based last-write-wins.
    return {id,heads,conflict:heads.length>1,rawText:root.data.text,createdAt:root.at,history:list, data:heads.length===1?heads[0].data:null};
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function makeBackup(events,projects,at=new Date().toISOString()) {
  validateEvents(events);
  return {schema:SCHEMA,exportedAt:at,timezone:'Asia/Shanghai',scope:'本机文字事件、项目名册及修改历史；运行日志另行存档',counts:{events:events.length,records:materialize(events).length,projects:projects.length},events,projects};
}
function readBackup(value) {
  if(value?.schema!==SCHEMA)throw new Error('不是兼容的手账备份');
  validateEvents(value.events);
  if(value.counts?.events!==value.events.length || value.counts?.records!==materialize(value.events).length)throw new Error('备份记录计数不一致');
  return value.events;
}
function coursesForDate(config,date) {
  const [t]=dayWindow(date), [first]=dayWindow(config.week_1_monday);
  const week=Math.floor((t-first)/DAY/7)+1, weekday=(new Date(t+8*3600000).getUTCDay()+6)%7;
  return config.courses.filter(c=>c.weeks[0]<=week&&week<=c.weeks[1]&&c.weekdays.includes(weekday));
}

function dateOffset(date,days){
  const [t]=dayWindow(date);
  return new Date(t+28800000+days*DAY).toISOString().slice(0,10);
}
function monthOffset(month,delta){
  dayWindow(month+'-01');
  const [y,m]=month.split('-').map(Number);
  return new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);
}
function calendarCells(month){
  const first=month+'-01',[t]=dayWindow(first),weekday=(new Date(t+28800000).getUTCDay()+6)%7;
  return Array.from({length:42},(_,i)=>dateOffset(first,i-weekday));
}
function overviewDateRange(month,scale='month',projects=[]){
  dayWindow(month+'-01');
  let start=month+'-01',end=dateOffset(monthOffset(month,1)+'-01',-1);
  if(scale==='quarter'){
    const [y,m]=month.split('-').map(Number),q=Math.floor((m-1)/3)*3+1;
    start=`${y}-${String(q).padStart(2,'0')}-01`;end=dateOffset(monthOffset(start.slice(0,7),3)+'-01',-1);
  }else if(scale==='year'){start=month.slice(0,4)+'-01-01';end=month.slice(0,4)+'-12-31';}
  else if(scale==='all'&&projects.length){
    const periods=projects.filter(p=>!p.archived).map(p=>p.period).filter(p=>p?.start&&p?.end);
    if(periods.length){start=periods.map(p=>p.start).sort()[0];end=periods.map(p=>p.end).sort().at(-1);}
  }
  return {start,end};
}
function selectionRange(date,unit='month'){
  dayWindow(date);
  if(unit==='day')return {start:date,end:date};
  if(!['month','quarter','year'].includes(unit))throw new Error('请选择日、月、季度或年');
  return overviewDateRange(date.slice(0,7),unit);
}
function shiftSelection(date,unit,delta){
  const range=selectionRange(date,unit);
  return unit==='day'?dateOffset(date,delta):monthOffset(range.start.slice(0,7),delta*(unit==='quarter'?3:unit==='year'?12:1))+'-01';
}
function calendarTimeLabel(calendar={}){
  return calendar.time?calendar.time+(calendar.endTime?'–'+calendar.endTime:''):calendar.kind==='deadline'?'ddl':'全天';
}
// All views, including the day page, consume this same read model.
function buildCalendarItems(config,events,start,end,projectId=''){
  if(typeof projectId!=='string')projectId=projectId?.projectId||'';
  const [a]=dayWindow(start),[,b]=dayWindow(end);
  if(b<=a||b-a>367*DAY)throw new Error('查看范围需在一年以内');
  const items=[];
  for(const record of materialize(events))for(const head of record.heads){
    const d=head.data;if(d.archived||d.date<start||d.date>end||!recordInProject(d,projectId))continue;
    const kind=record.conflict?'conflict':d.type==='calendar'?(d.calendar?.kind==='deadline'?'deadline':'calendar'):d.type==='artifact'?'note':d.type;
    const time=d.type==='calendar'?(d.calendar?.time||''):'';
    items.push({id:`record:${record.id}:${head.id}`,recordId:record.id,date:d.date,title:d.text,kind,finance:d.finance,source:'record',recordType:d.type==='artifact'?'note':d.type,projectId:d.projectId,projectIds:recordProjectIds(d),time,timeLabel:d.type==='calendar'?calendarTimeLabel(d.calendar):kind==='action'?'行动':kind==='finance'?'财务':kind==='conflict'?'待合并':'备忘',location:d.calendar?.location||'',createdAt:head.at,conflict:record.conflict});
  }
  return items.sort((x,y)=>x.date.localeCompare(y.date)||(x.time||'').localeCompare(y.time||'')||(x.createdAt||'').localeCompare(y.createdAt||'')||x.id.localeCompare(y.id));
}
function projectGanttRows(projects,events,range){
  const [a]=dayWindow(range.start),[,b]=dayWindow(range.end),duration=b-a;
  const records=materialize(events);
  return projects.flatMap(project=>{
    if(project.archived)return [];
    const linked=records.filter(r=>r.heads.some(h=>!h.data.archived&&recordInProject(h.data,project.id)&&h.data.date>=range.start&&h.data.date<=range.end));
    const milestones=linked.filter(r=>!r.conflict&&r.data.type==='calendar').map(r=>{
      const [t]=dayWindow(r.data.date);
      return {recordId:r.id,date:r.data.date,title:r.data.text,kind:r.data.calendar?.kind==='deadline'?'deadline':'calendar',left:((t-a+DAY/2)/duration)*100};
    });
    if(!project.period)return [{project,records:linked.length,milestones,bar:null}];
    const [ps]=dayWindow(project.period.start),[,pe]=dayWindow(project.period.end),left=Math.max(ps,a),right=Math.min(pe,b);
    if(right<=left&&!linked.length)return [];
    return [{project,records:linked.length,milestones,bar:right>left?{left:(left-a)/duration*100,width:(right-left)/duration*100,clippedStart:ps<a,clippedEnd:pe>b}:null}];
  });
}

const PROJECT_TYPES=Object.freeze({life:'生活立德',brand:'做事立功：品牌打造',clients:'做事立功：客户运营',products:'做事立功：产服销售',investment:'做事立功：理财投资',voice:'发声立言'});
function projectTypeLabel(p){return PROJECT_TYPES[p?.type]||'未设置类型';}
function projectChoiceLabel(p,full=false){return `（${projectTypeLabel(p)}）`+(full?p.headings.join(' ／ '):p.headings[0]);}
const projectCollator=new Intl.Collator('zh-CN-u-co-pinyin',{numeric:true,sensitivity:'base',ignorePunctuation:true});
function projectInitial(title){const first=[...title].find(c=>/[\p{L}\p{N}]/u.test(c))||'';if(/^[a-z0-9]$/i.test(first))return first.toUpperCase();const boundaries=[...'阿芭擦搭蛾发噶哈击喀垃妈拿哦啪期然撒塌挖昔压匝'],letters='ABCDEFGHJKLMNOPQRSTWXYZ';for(let i=boundaries.length-1;i>=0;i--)if(projectCollator.compare(first,boundaries[i])>=0)return letters[i];return first;}
function sortProjects(list){const order=Object.keys(PROJECT_TYPES);return [...list].sort((a,b)=>{const ai=order.indexOf(a.type),bi=order.indexOf(b.type),an=a.headings.join(''),bn=b.headings.join('');return (ai<0?6:ai)-(bi<0?6:bi)||projectInitial(an).localeCompare(projectInitial(bn),'en')||projectCollator.compare(an,bn)||a.id.localeCompare(b.id);});}
function projectMatchesRange(p,range,records=[]){
 if(range.start==='0001-01-01'&&range.end==='9999-12-31')return true;
 if(p.period)return p.period.start<=range.end&&p.period.end>=range.start;
 const createdAt=Date.parse(p.createdAt),created=Number.isFinite(createdAt)?new Date(createdAt+28800000).toISOString().slice(0,10):'';
 return !!(created&&created>=range.start&&created<=range.end)||records.some(r=>r.heads.some(h=>!h.data.archived&&recordInProject(h.data,p.id)&&h.data.date>=range.start&&h.data.date<=range.end));
}
function projectData(p){return {headings:[...p.headings],period:p.period?{start:p.period.start,end:p.period.end}:null,archived:!!p.archived,...(p.type!==undefined?{type:p.type}:{})};}
function validateProjectData(data){
 if(!data||!Array.isArray(data.headings)||!data.headings.length||data.headings.length>8||data.headings.some(h=>typeof h!=='string'||!h.trim()||h.length>300)||typeof data.archived!=='boolean')throw new Error('项目名称无效');
 if(data.type!==undefined&&data.type!==''&&!Object.hasOwn(PROJECT_TYPES,data.type))throw new Error('项目类型无效');
 if(data.period!==null){dayWindow(data.period?.start);dayWindow(data.period?.end);if(data.period.end<data.period.start)throw new Error('结束日期早于开始日期');}
 return data;
}
function projectHeads(p){const ev=p.logProject?.events||[],used=new Set(ev.flatMap(e=>e.parents));return ev.filter(e=>!used.has(e.id)).sort((a,b)=>a.id.localeCompare(b.id));}
function projectHasConflict(p){return projectHeads(p).length>1;}
function projectedProjectData(p){const heads=projectHeads(p),chosen=heads.find(h=>h.data.archived)||heads[0];return chosen?chosen.data:p.logProject?.base||projectData(p);}
function validateProject(p){
 if(!p||typeof p.id!=='string'||!p.id)throw new Error('项目编号无效');validateProjectData(projectData(p));
 if(!p.logProject)return p;
 const log=p.logProject;if(log.version!==1||!Array.isArray(log.events)||log.events.length>20000)throw new Error('项目历史格式无效');validateProjectData(log.base);
 const ids=new Map();for(const e of log.events){if(typeof e.id!=='string'||!e.id||ids.has(e.id)||!Array.isArray(e.parents)||new Set(e.parents).size!==e.parents.length||!['revise','archive','restore','resolve'].includes(e.op)||!Number.isFinite(Date.parse(e.at)))throw new Error('项目修改格式无效');validateProjectData(e.data);ids.set(e.id,e);}
 const visiting=new Set(),done=new Set();function visit(id){if(!ids.has(id))throw new Error('项目历史缺少前序');if(visiting.has(id))throw new Error('项目历史形成循环');if(done.has(id))return;visiting.add(id);ids.get(id).parents.forEach(visit);visiting.delete(id);done.add(id);}for(const id of ids.keys())visit(id);
 if(stableEventJSON(projectData(p))!==stableEventJSON(projectedProjectData(p)))throw new Error('项目当前内容与历史不一致');return p;
}
function projectWithLog(template,base,events){const {type:oldType,...rest}=template,temp={...rest,logProject:{version:1,base,events:[...events].sort((a,b)=>a.id.localeCompare(b.id))}},d=projectedProjectData(temp),date=s=>s.split('-').map(Number).join('.');return {...temp,headings:[...d.headings],period:d.period?{...d.period,display_lines:[date(d.period.start),'–',date(d.period.end)]}:null,archived:d.archived,...(d.type!==undefined?{type:d.type}:{})};}
function mergeProjectCatalog(local,remote){
 const map=new Map();for(const p of [...local,...remote]){validateProject(p);const old=map.get(p.id);if(!old){map.set(p.id,p);continue;}if(stableEventJSON(old)===stableEventJSON(p))continue;
  const strip=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['headings','period','archived','type','logProject'].includes(k))),a=old.logProject?.base||projectData(old),b=p.logProject?.base||projectData(p);
  if(stableEventJSON(strip(old))!==stableEventJSON(strip(p))||stableEventJSON(a)!==stableEventJSON(b))throw new Error('同一项目的原始名册不同，两个版本均已保留');
  const events=new Map();for(const e of [...old.logProject?.events||[],...p.logProject?.events||[]]){if(events.has(e.id)&&stableEventJSON(events.get(e.id))!==stableEventJSON(e))throw new Error('项目修改编号冲突，未覆盖');events.set(e.id,e);}const merged=projectWithLog(old,a,[...events.values()]);validateProject(merged);map.set(p.id,merged);
 }
 return [...map.values()].sort((a,b)=>(a.sourceLeaf||0)-(b.sourceLeaf||0)||a.id.localeCompare(b.id));
}
function appendProjectRevision(p,event){validateProject(p);validateProjectData(event.data);const base=p.logProject?.base||projectData(p),events=p.logProject?.events||[];const found=events.find(e=>e.id===event.id);if(found){if(stableEventJSON(found)!==stableEventJSON(event))throw new Error('项目修改编号冲突');return p;}const next=projectWithLog(p,base,[...events,event]);validateProject(next);return next;}
function makeProject(id,data,at){validateProjectData(data);return projectWithLog({id,kind:'自建项目',createdAt:at,headings:data.headings,period:data.period,archived:data.archived},data,[]);}

const CLOUD_SCHEMA='log-cloud-v1';
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
function validateCatalog(projects,courses){
  if(!Array.isArray(projects)||projects.length>2000)throw new Error('项目名册格式无效');
  const ids=new Set();
  for(const p of projects){
    if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||!Array.isArray(p.headings)||!p.headings.length||p.headings.some(h=>typeof h!=='string'||!h.trim()))throw new Error('项目名册内容无效');
    validateProject(p);ids.add(p.id);
  }
  if(!courses||!Array.isArray(courses.courses))throw new Error('课表格式无效');
  dayWindow(courses.week_1_monday);
  for(const c of courses.courses){
    if(!c||typeof c.id!=='string'||typeof c.display_name!=='string'||typeof c.location!=='string'||!Array.isArray(c.weekdays)||!Array.isArray(c.weeks)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.end)||c.end<=c.start)throw new Error('课表内容无效');
  }
  return true;
}
function cloudSnapshot(events,projects,courses){
  validateEvents(events);validateCatalog(projects,courses);
  return {schema:CLOUD_SCHEMA,events,projects,courses};
}
function readCloudSnapshot(data){
  if(data?.schema!==CLOUD_SCHEMA)throw new Error('云端数据格式不兼容，未覆盖现有记录');
  return cloudSnapshot(data.events,data.projects,data.courses);
}
function sameCloudSnapshot(a,b){
 const ordered=value=>({...value,events:[...value.events].sort((x,y)=>x.id.localeCompare(y.id)),projects:[...value.projects].sort((x,y)=>x.id.localeCompare(y.id)),courses:{...value.courses,courses:[...value.courses.courses].sort((x,y)=>x.id.localeCompare(y.id))}});
 return canonical(ordered(a))===canonical(ordered(b));
}
function mergeCloudSnapshots(local,remote){
  readCloudSnapshot(local);readCloudSnapshot(remote);
  const projects=mergeProjectCatalog(local.projects,remote.projects);
  let courses=local.courses;
  if(!courses.courses.length)courses=remote.courses;
  else if(remote.courses.courses.length&&canonical(courses)!==canonical(remote.courses))throw new Error('课表存在不同版本；现有数据未覆盖');
  return cloudSnapshot(mergeEvents(local.events,remote.events),projects,courses);
}
function readRunDay(value){
 if(value?.schema!=='log-runs-v1'||!/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')||!Array.isArray(value.runs)||value.runs.length>100000)throw new Error('运行日志格式无效');
 const ids=new Set();
 for(const r of value.runs){
  if(typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||r.name.length>200||!Array.isArray(r.segments)||!Array.isArray(r.usageEvents))throw new Error('任务日志格式无效');ids.add(r.id);
  for(const s of r.segments)if(!Number.isFinite(Date.parse(s.start))||s.end&&!Number.isFinite(Date.parse(s.end)))throw new Error('运行时段无效');
  for(const u of r.usageEvents)if(!Number.isFinite(Date.parse(u.at))||['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','totalTokens'].some(k=>u[k]!==undefined&&(!Number.isSafeInteger(u[k])||u[k]<0)))throw new Error('用量回报无效');
 }
 return value;
}
function runUsage(runs,date){
 const start=Date.parse(date+'T00:00:00+08:00'),end=start+86400000,seen=new Set(),totals={inputTokens:0,outputTokens:0,cachedInputTokens:0,reasoningOutputTokens:0,totalTokens:0,reports:0};
 for(const r of runs)for(const u of r.usageEvents||[]){const at=Date.parse(u.at),id=u.id||r.id+':'+u.at;if(at<start||at>=end||seen.has(id))continue;seen.add(id);totals.reports++;for(const k of Object.keys(totals))if(k!=='reports')totals[k]+=u[k]??(k==='totalTokens'?(u.inputTokens||0)+(u.outputTokens||0):0);}
 return totals;
}

function mergeRunParts(date,parts){
 const byid=new Map();
 for(const part of parts){if(part.schema!=='log-runs-v1'||part.date!==date)throw new Error('运行分段日期不符');for(const r of part.runs){
  const old=byid.get(r.id);if(!old){byid.set(r.id,JSON.parse(JSON.stringify(r)));continue;}
  old.segments.push(...r.segments);const usage=new Map(old.usageEvents.map(u=>[u.id,u]));for(const u of r.usageEvents)usage.set(u.id,u);old.usageEvents=[...usage.values()];
  if(Date.parse(r.lastHeartbeat)>=Date.parse(old.lastHeartbeat)){old.lastHeartbeat=r.lastHeartbeat;old.state=r.state;old.model=r.model;old.name=r.name;}
 }}
 const runs=[...byid.values()];for(const r of runs){r.segments.sort((a,b)=>a.start.localeCompare(b.start));r.usageEvents.sort((a,b)=>a.at.localeCompare(b.at));}
 return{schema:'log-runs-v1',date,timezone:'Asia/Shanghai',runs};
}

async function validateMonthlyExport(value){
 if(value?.schema!=='log-monthly-export-v1'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month||'')||!/^[a-f0-9]{64}$/.test(value.sourceHash||'')||value.source?.schema!=='log-monthly-source-v1'||value.source.month!==value.month||!Array.isArray(value.source.events)||!Array.isArray(value.source.days)||!Array.isArray(value.source.projects)||!Number.isSafeInteger(value.pages)||value.pages<2||value.pages%2||value.pages>2000||value.logicalPages!==value.pages*2||typeof value.pdfBase64!=='string'||value.pdfBase64.length>28*1024*1024||!/^JVBERi0[A-Za-z0-9+/=\r\n]*$/.test(value.pdfBase64))throw new Error('月度存档格式无效');
 const text=stableEventJSON(value.source),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==value.sourceHash)throw new Error('月度来源校验未通过');
 return value;
}
const base=new URL(CONFIG.basePath,self.location.origin),repo='repos/'+CONFIG.owner+'/'+CONFIG.repository;
const publicFiles=new Set(["vault-worker.js", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "icons/icon.svg", "icons/wordmark.svg", "icons/favicon-32.png", "icons/apple-touch-icon-167.png", "icons/apple-touch-icon-152.png", "icons/app-192.png", "icons/app-512.png", "icons/maskable-512.png", "access/login.html", "access/github-callback.html", "access/login.css", "access/config.js", "access/session.js", "access/protect.js", "access/login.js", "access/wordmark.svg"].map(p=>new URL(p,base).pathname));
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const forcedHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const pagePolicy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-src blob:; frame-ancestors 'none'";
const b64=bytes=>{const value=new Uint8Array(bytes),parts=[];for(let at=0;at<value.length;at+=16384)parts.push(String.fromCharCode(...value.subarray(at,at+16384)));return btoa(parts.join(''));};
const unb64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),s=>s.charCodeAt(0));
const dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('log-github-access-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('session');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function db(op,value,key=base.href){const database=await dbPromise;return new Promise((resolve,reject)=>{const tx=database.transaction('session',op==='get'?'readonly':'readwrite'),s=tx.objectStore('session');const q=op==='get'?s.get(key):op==='put'?s.put(value,key):s.delete(key);tx.oncomplete=()=>resolve(q.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
const pendingKey=base.href+'oauth-pending';
async function pendingLogin(value,expectedState){
 if(value===null){const saved=await db('get',null,pendingKey);if(!expectedState||saved?.state===expectedState)await db('delete',null,pendingKey);return null;}
 if(value===undefined){const pending=await db('get',null,pendingKey);if(!pending)return null;if(!Number.isFinite(pending.at)||Date.now()-pending.at>600000||Date.now()<pending.at){await db('delete',null,pendingKey);return null;}return pending;}
 if(!/^[A-Za-z0-9_-]{43}$/.test(value.state||'')||!/^[A-Za-z0-9_-]{43}$/.test(value.verifier||'')||!Number.isFinite(value.at)||Math.abs(Date.now()-value.at)>600000||!['normal','standalone'].includes(value.mode)||value.mode==='standalone'&&!/^[A-Za-z0-9_-]{43}$/.test(value.claim||'')||typeof value.returnTo!=='string'||value.returnTo.length>2048)throw new Error('登录接续格式无效。');
 const returnTo=new URL(value.returnTo,base);if(returnTo.origin!==base.origin||!returnTo.pathname.startsWith(base.pathname))throw new Error('登录返回位置无效。');
 await db('put',{state:value.state,verifier:value.verifier,at:value.at,mode:value.mode,claim:value.claim||null,returnTo:returnTo.href},pendingKey);return{saved:true};
}
let state,manifestPromise,generation=0,writeQueue=Promise.resolve();
async function forget(){generation++;state=null;manifestPromise=null;await db('delete');for(const tab of await self.clients.matchAll({type:'window'}))if(tab.url.startsWith(base.href))tab.postMessage({type:'private-logout'});}
async function session(){if(state===undefined){const before=generation,stored=await db('get');if(before===generation&&state===undefined)state=stored||null;}if(state&&(state.auth!=='github-oauth-v1'||state.expires<=Date.now()))await forget();return state;}
async function github(path,token,{raw=false,method='GET',body}={}){
 const response=await fetch('https://api.github.com/'+path,{method,headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok){const err=new Error(response.status===401?'GitHub 登录已失效，请重新登录。':response.status===403||response.status===404?'log 私有仓库尚未授权读写，请检查 GitHub App 的安装范围。':'GitHub 暂时无法连接，本机记录已保留。');err.status=response.status;throw err;}
 return raw?response.arrayBuffer():response.json();
}
const vaultPath=name=>repo+'/contents/'+name+'?ref='+encodeURIComponent(CONFIG.revision);
async function decrypt(key,bytes,name){const b=new Uint8Array(bytes);if(b.length<29)throw new Error('加密文件不完整。');return crypto.subtle.decrypt({name:'AES-GCM',iv:b.subarray(0,12),additionalData:encoder.encode('log-vault:v1:'+name)},key,b.subarray(12));}
async function encrypt(key,bytes,name){const iv=crypto.getRandomValues(new Uint8Array(12)),body=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('log-vault:v1:'+name)},key,bytes),packet=new Uint8Array(12+body.byteLength);packet.set(iv);packet.set(new Uint8Array(body),12);return packet;}
async function inflate(bytes){return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
async function ciphertext(name,active){
 const cache=await caches.open('log-ciphertext-v1:'+base.pathname),url=new URL('access/cipher/'+CONFIG.revision+'/'+name,base);
 const existing=await cache.match(url);if(existing)return existing.arrayBuffer();
 const bytes=await github(vaultPath(name),active.token,{raw:true});await cache.put(url,new Response(bytes));return bytes;
}
async function manifest(active){const bytes=await ciphertext('manifest.bin',active),m=JSON.parse(decoder.decode(await inflate(await decrypt(active.key,bytes,'manifest'))));if(m.version!==1||!m.files?.['index.html']||!m.files?.['log-app.js'])throw new Error('应用目录有误。');return m.files;}
async function readingKey(token){
 const raw=await github(repo+'/contents/access/key.json?ref='+encodeURIComponent(CONFIG.branch),token,{raw:true}),setting=JSON.parse(decoder.decode(raw));
 if(setting.version!==1||setting.ownerId!==CONFIG.ownerId||setting.repositoryId!==CONFIG.repositoryId||!/^[A-Za-z0-9_-]{43}$/.test(setting.key||''))throw new Error('私有仓库密钥配置有误。');
 const clear=unb64(setting.key);if(clear.byteLength!==32)throw new Error('私有仓库密钥配置有误。');return crypto.subtle.importKey('raw',clear,'AES-GCM',false,['decrypt','encrypt']);
}
async function verifyWrite(active){
 // A same-content commit verifies write access without inventing a journal record.
 for(let attempt=0;attempt<3;attempt++){
  const file=await snapshotFile(active);
  readCloudSnapshot(JSON.parse(decoder.decode(await decrypt(active.key,file.bytes,'snapshot'))));
  try{await github(repo+'/contents/data/snapshot.bin',active.token,{method:'PUT',body:{message:'log: verify owner connection',content:b64(file.bytes),sha:file.sha,branch:CONFIG.branch}});return;}
  catch(error){if(error.status!==409&&error.status!==422)throw error;}
 }
 throw new Error('其他设备正在同步，请稍后连接。');
}
async function signIn(token,expiresIn){
 if(typeof token!=='string'||!/^ghu_[A-Za-z0-9_]{24,255}$/.test(token)||!Number.isSafeInteger(expiresIn)||expiresIn<60||expiresIn>28800)throw new Error('GitHub 登录授权无效，请重新登录。');
 if(!CONFIG.revision||CONFIG.authMode!=='github-oauth-v1')throw new Error('应用尚未发布。');
 const before=generation,profile=await github('user',token);
 if(profile.id!==CONFIG.ownerId||profile.login!==CONFIG.owner)throw new Error('此账号没有 log 访问权限。');
 const repository=await github(repo,token);if(!repository.private||repository.id!==CONFIG.repositoryId||repository.owner?.id!==CONFIG.ownerId)throw new Error('必须使用本人拥有的私有仓库。');
 const key=await readingKey(token),next={auth:'github-oauth-v1',username:CONFIG.owner,token,key,expires:Date.now()+(expiresIn-30)*1000,csrf:crypto.randomUUID()};
 const files=await manifest(next);await verifyWrite(next);if(before!==generation)throw new Error('连接状态已变化，请重试。');
 await db('put',next);if(before!==generation){await db('delete');throw new Error('连接状态已变化，请重试。');}
 state=next;manifestPromise=Promise.resolve(files);generation++;return{username:next.username};
}
async function snapshotFile(active){
 const file=await github(repo+'/contents/data/snapshot.bin?ref='+encodeURIComponent(CONFIG.branch),active.token);
 if(!/^[a-f0-9]{40}$/.test(file.sha||'')||file.size>31*1024*1024)throw new Error('云端记录格式或大小无效，现有记录未覆盖。');
 let bytes;
 if(file.encoding==='base64'&&typeof file.content==='string')bytes=unb64(file.content.replace(/\s/g,''));
 else if(file.encoding==='none')bytes=new Uint8Array(await github(repo+'/git/blobs/'+file.sha,active.token,{raw:true}));
 else throw new Error('云端记录格式有误，现有记录未覆盖。');
 if(bytes.byteLength!==file.size)bytes=new Uint8Array(await github(repo+'/git/blobs/'+file.sha,active.token,{raw:true}));
 return{sha:file.sha,bytes};
}
async function loadSnapshot(active){
 const file=await snapshotFile(active);
 return{sha:file.sha,snapshot:readCloudSnapshot(JSON.parse(decoder.decode(await decrypt(active.key,file.bytes,'snapshot'))))};
}
async function mergeAndSave(incoming,active,change){
 readCloudSnapshot(incoming);
 for(let attempt=0;attempt<4;attempt++){
  const remote=await loadSnapshot(active),merged=mergeCloudSnapshots(incoming,remote.snapshot);
  if(change!==generation||(await session())!==active)throw new Error('登录状态已变化，记录留在本机。');
  if(canonical(merged)===canonical(remote.snapshot))return merged;
  const clear=encoder.encode(JSON.stringify(merged));if(clear.length>30*1024*1024)throw new Error('记录已达单次同步容量，请先导出备份。');
  const packet=await encrypt(active.key,clear,'snapshot');
  if(change!==generation||(await session())!==active)throw new Error('登录状态已变化，记录留在本机。');
  try{await github(repo+'/contents/data/snapshot.bin',active.token,{method:'PUT',body:{message:'log: merge records '+new Date().toISOString(),content:b64(packet),sha:remote.sha,branch:CONFIG.branch}});return merged;}
  catch(error){if(error.status!==409&&error.status!==422)throw error;}
 }
 throw new Error('其他设备正在同步，本机记录已保留，请稍后重试。');
}
async function loadRunFeed(active,name,version){
 const cache=await caches.open('log-runs-ciphertext-v1:'+base.pathname),cacheKey=new URL('access/run-cipher/'+name,base).href;let bytes;
 const cached=await cache.match(cacheKey);if(version&&cached?.headers.get('X-Log-Version')===version)return JSON.parse(decoder.decode(await inflate(await decrypt(active.key,await cached.arrayBuffer(),'runs'))));
 try{
  const file=await github(repo+'/contents/data/runs/'+name+'.bin?ref='+encodeURIComponent(CONFIG.branch),active.token);
  if(file.size>20*1024*1024)throw new Error('运行日志过大。');
  const previous=await cache.match(cacheKey);if(previous?.headers.get('X-Log-Sha')===file.sha)return JSON.parse(decoder.decode(await inflate(await decrypt(active.key,await previous.arrayBuffer(),'runs'))));
  if(file.encoding==='base64')bytes=unb64(file.content.replace(/\s/g,''));else if(file.encoding==='none')bytes=new Uint8Array(await github(repo+'/git/blobs/'+file.sha,active.token,{raw:true}));else throw new Error('运行日志格式无效。');
  if(bytes.byteLength!==file.size)bytes=new Uint8Array(await github(repo+'/git/blobs/'+file.sha,active.token,{raw:true}));
  // Authenticate before replacing the last usable encrypted cache.
  const data=JSON.parse(decoder.decode(await inflate(await decrypt(active.key,bytes,'runs'))));
  if(name==='index'){if(data.schema!=='log-run-index-v1'||!Array.isArray(data.dates))throw new Error('运行索引无效。');}else if(data.schema==='log-run-day-v1'){if(data.date!==name||!Array.isArray(data.parts)||data.parts.length>24||data.parts.some(p=>!new RegExp('^'+name+'-(0[0-9]|1[0-9]|2[0-3])$').test(p)))throw new Error('运行分段索引无效。');}else{readRunDay(data);if(data.date!==name.slice(0,10))throw new Error('运行日志日期不匹配。');}
  await cache.put(cacheKey,new Response(bytes,{headers:{'X-Log-Sha':file.sha,...(version?{'X-Log-Version':version}:{})}}));return data;
 }catch(error){
  if(error.status===401)throw error;
  if(error.status===404)return null;
  const saved=await cache.match(cacheKey);if(!saved)throw error;
  return JSON.parse(decoder.decode(await inflate(await decrypt(active.key,await saved.arrayBuffer(),'runs'))));
 }
}
async function saveMonthlyExport(value,active,change){
 const item=await validateMonthlyExport(value),name='data/exports/'+item.month+'/'+item.sourceHash+'.bin',aad='monthly:'+item.month+':'+item.sourceHash;
 try{await github(repo+'/contents/'+name+'?ref='+encodeURIComponent(CONFIG.branch),active.token);return {saved:true,sourceHash:item.sourceHash};}catch(error){if(error.status!==404)throw error;}
 const bytes=encoder.encode(JSON.stringify(item)),compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),packet=await encrypt(active.key,compressed,aad);
 if(change!==generation||(await session())!==active)throw new Error('请重新登录');
 try{await github(repo+'/contents/'+name,active.token,{method:'PUT',body:{message:'log: archive '+item.month,content:b64(packet),branch:CONFIG.branch}});}
 catch(error){if(![409,422].includes(error.status))throw error;await github(repo+'/contents/'+name+'?ref='+encodeURIComponent(CONFIG.branch),active.token);}
 return {saved:true,sourceHash:item.sourceHash};
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...forcedHeaders,'Content-Type':'application/json; charset=utf-8'}});
async function apiRequest(event,path){
 const active=await session();if(!active)return json({error:'请重新登录。'},401);
 const change=generation,request=event.request;
 if(path==='api/status'&&request.method==='GET')return json({app:'log',csrf:active.csrf,username:active.username});
 if(request.method==='POST'){
  const source=event.clientId&&await self.clients.get(event.clientId);
  if(!source?.url.startsWith(base.href)||request.headers.get('X-Log-CSRF')!==active.csrf||!/^application\/json\b/.test(request.headers.get('Content-Type')||''))return json({error:'请求无效。'},403);
 }
 try{
  if(path==='api/logout'&&request.method==='POST'){await forget();return json({ok:true});}
  if(request.method==='GET'&&(path==='api/runs'||path==='api/runs-index')){
   const date=new URL(request.url).searchParams.get('date'),name=path==='api/runs-index'?'index':date;
   if(name!=='index'){try{dayWindow(name);}catch{return json({error:'运行日期无效。'},400);}}
   let data=await loadRunFeed(active,name);if(data?.schema==='log-run-day-v1'){const parts=[];for(let at=0;at<data.parts.length;at+=4){const batch=await Promise.all(data.parts.slice(at,at+4).map(p=>loadRunFeed(active,p,data.versions?.[p])));if(batch.some(p=>!p))throw new Error('运行分段尚未收齐，请稍后刷新。');parts.push(...batch);}data=readRunDay(mergeRunParts(name,parts));}if(change!==generation)return json({error:'请重新登录。'},401);
   return data?json(data):name==='index'?json({error:'尚无自动采集记录。'},404):json({schema:'log-runs-v1',date:name,timezone:'Asia/Shanghai',runs:[]});
  }

  if(path==='api/monthly-export'&&request.method==='POST'){
   if(Number(request.headers.get('Content-Length'))>30*1024*1024)return json({error:'月度存档超过单次容量'},413);
   const text=await request.text();if(encoder.encode(text).length>30*1024*1024)return json({error:'月度存档超过单次容量'},413);
   const incoming=JSON.parse(text),job=writeQueue.then(()=>saveMonthlyExport(incoming,active,change));writeQueue=job.catch(()=>{});return json(await job);
  }
  if(path==='api/snapshot'&&request.method==='GET'){const remote=await loadSnapshot(active);if(change!==generation)return json({error:'请重新登录。'},401);return json(remote.snapshot);}
  if(path==='api/snapshot'&&request.method==='POST'){
   const size=Number(request.headers.get('Content-Length'));if(size>30*1024*1024)return json({error:'记录超过单次同步容量，请先导出备份。'},413);
   const text=await request.text();if(encoder.encode(text).length>30*1024*1024)return json({error:'记录超过单次同步容量，请先导出备份。'},413);
   const incoming=readCloudSnapshot(JSON.parse(text));
   const job=writeQueue.then(()=>mergeAndSave(incoming,active,change));writeQueue=job.catch(()=>{});return json(await job);
  }
  return json({error:'未找到操作。'},404);
 }catch(error){if(error.status===401){await forget();return json({error:'请重新登录。'},401);}return json({error:error.message||'同步未完成，本机记录已保留。'},502);}
}
async function openFile(active,path,change){
 if(!manifestPromise)manifestPromise=manifest(active).catch(error=>{manifestPromise=null;throw error;});
 const files=await manifestPromise,record=Object.hasOwn(files,path)?files[path]:null;if(!record)return null;
 const [object,type,compressed]=record;if(!/^[a-f0-9]{64}$/.test(object))throw new Error('索引记录有误。');
 const encrypted=await ciphertext('blobs/'+object.slice(0,2)+'/'+object+'.bin',active),bytes=await decrypt(active.key,encrypted,object),body=compressed?await inflate(bytes):bytes;
 if(change!==generation||(await session())!==active)return null;
 return new Response(body,{headers:{...forcedHeaders,'Content-Type':type,...(type.startsWith('text/html')?{'Content-Security-Policy':pagePolicy}:{})}});
}
const publicCacheName='log-public-shell-v1:'+base.pathname;
async function publicResource(request){
 const key=new URL(request.url);key.search='';key.hash='';const cache=await caches.open(publicCacheName);
 try{const response=await fetch(request);if(response.ok)await cache.put(key.href,response.clone());return response;}
 catch(error){const saved=await cache.match(key.href);if(saved)return saved;throw error;}
}
async function warmPublicShell(){await Promise.allSettled([...publicFiles].filter(path=>/access\/|manifest|icon\.svg|apple-touch-icon\.png/.test(path)).map(path=>publicResource(new Request(new URL(path,base.origin),{cache:'reload',signal:AbortSignal.timeout(6000)}))));}
async function loginPage(){const shell=await publicResource(new Request(new URL('access/login.html',base),{cache:'no-store'}));return new Response(shell.body,{headers:{...forcedHeaders,'Content-Type':'text/html; charset=utf-8'}});}
async function handle(event,url){
 let path;try{path=decodeURIComponent(url.pathname.slice(base.pathname.length));}catch{return new Response(null,{status:400});}
 if(path.startsWith('api/'))return apiRequest(event,path);
 if(event.request.method!=='GET')return new Response(null,{status:405});
 const inactive=()=>event.request.mode==='navigate'?loginPage():new Response(null,{status:401,headers:forcedHeaders});
 const active=await session();if(!active)return inactive();const change=generation;
 if(!path||path.endsWith('/'))path+='index.html';
 try{const file=await openFile(active,path,change);if(change!==generation)return inactive();return file||new Response(null,{status:404,headers:forcedHeaders});}
 catch(error){if(error.status===401){await forget();return inactive();}return new Response('暂时无法打开，请联网后刷新。',{status:502,headers:{...forcedHeaders,'Content-Type':'text/plain;charset=utf-8'}});}
}
self.addEventListener('install',event=>event.waitUntil(Promise.all([self.skipWaiting(),warmPublicShell()])));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 const port=event.ports[0];if(!port||!event.source?.url?.startsWith(base.href))return;
 const message=event.data||{};
 const job=message.type==='login'?signIn(message.token,message.expiresIn):message.type==='session'?session().then(active=>active?{username:active.username}:null):message.type==='logout'?forget():message.type==='login-pending-save'?pendingLogin(message.pending):message.type==='login-pending-read'?pendingLogin():message.type==='login-pending-clear'?pendingLogin(null,message.state):Promise.reject(new Error('请求无效。'));
 event.waitUntil(job.then(result=>port.postMessage({ok:true,result}),error=>port.postMessage({ok:false,error:error.message})));
});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;if(publicFiles.has(url.pathname)){if(event.request.method==='GET')event.respondWith(publicResource(event.request));return;}event.respondWith(handle(event,url));});
