import {importanceLabels,loadSwimlane,swimlaneDateRange,eventPeriods,eventMonthLabel,packTimelineItems,placeRelationLabel,cardRelationPaths,relationChain} from '../swimlane-data.js';
import {getSwimlaneEmbed,setupSwimlaneModal} from './swimlane-modal.js';

const $=id=>document.getElementById(id);
const make=(tag,cls='',label='')=>Object.assign(document.createElement(tag),{className:cls,textContent:label});
const button=(label,click,cls='')=>{
 const node=make('button',cls,label);
 node.type='button';
 node.addEventListener('click',click);
 return node;
};
const svg=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
 return node;
};
const icon=d=>{
 const node=svg('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':true});
 node.append(svg('path',{d}));
 return node;
};
const DAY=86400000;
const monthOf=t=>new Date(t).getUTCFullYear()*12+new Date(t).getUTCMonth();
const monthStart=m=>Date.UTC(Math.floor(m/12),m%12,1);
const yearFloor=m=>Math.floor(m/12)*12;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
function riseIn(node,delay=0){
 if(!reducedMotion.matches)node.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{
  duration:440,delay,easing:'ease-out',fill:'backwards'
 });
}
const bounds=value=>swimlaneDateRange(value,SheetData.dateRange);
const periodInterval=period=>({
 start:period.start?bounds(period.start).start:-Infinity,
 end:period.end?bounds(period.end).end+DAY:Infinity,
});
const params=new URLSearchParams(location.search);
const frame=window.frameElement;
const categoryPalette=[
 ['빨강','#a23d35'],['주황','#a75726'],['황토','#85651c'],['초록','#477446'],
 ['청록','#327771'],['파랑','#3e609d'],['보라','#715286'],['분홍','#9a4f72']
];
async function init(){
 const embed=frame&&getSwimlaneEmbed(frame);
 const root=document.documentElement;
 const ownsScroll=()=>!embed||root.classList.contains('swimlane-expanded');
 const scrollHost=()=>ownsScroll()?window:embed.scrollWindow;
 const frameTop=()=>ownsScroll()?0:embed.bounds().top;
 const pkg=params.get('package')==='cold-war'?'cold-war':'japan';
 const data=frame?.lessonSwimlane??await loadSwimlane(SHEET_CONFIG,SheetData,pkg);
 let {events,categories,actors,relations,periods,availableCategories=categories}=data;
 if(!events.length)throw Error('표시할 수업 사건이 없습니다.');
 let reader=setupSwimlaneModal(data,frame);
 const open=(kind,record)=>{pauseSequence();reader.open(kind,record);};
 const records=new Map(),role=new Map(),intervals=new Map();
 let min=Infinity,max=-Infinity;
 function indexLesson(){
  records.clear();role.clear();intervals.clear();
  for(const [kind,list] of [['event',events],['category',categories],['actor',actors]])for(const record of list){
   records.set(record.id,record);role.set(record.id,kind);
   const date=record.date||record.start;
   if(!date&&!record.end)continue;
   const start=date?bounds(date).start:-Infinity;
   const end=record.end?bounds(record.end).end+DAY:date?bounds(date).end+DAY:Infinity;
   intervals.set(record.id,{start,end});
   for(const time of [start,end-1])if(Number.isFinite(time)){
    const year=new Date(time).getUTCFullYear();
    min=Math.min(min,year*12);max=Math.max(max,(year+1)*12);
   }
  }
 }
 indexLesson();
 const requested=params.get('focus');
 const initial=/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(requested)?bounds(requested).start:null;
 let anchor=initial??Math.min(...events.map(e=>intervals.get(e.id).start));
 let size=initial!==null?12:frame?.hasAttribute('data-package-draft')?0:36;
 let sequence=null,allEdges=false,fontsReady=false,animatedRange='';
 let selected='',relationFocus=null,preferred=null,anchors=new Map(),start,end,ticks,plotWidth;
 const laneOverrides=new Set();
 let expandByDefault=false;
 const laneExpanded=category=>expandByDefault!==laneOverrides.has(category.id);
 const canReceive=c=>c.kind==='theme'||c.kind==='arc';
 const laneCategories=()=> (frame?.moveWorkspaceCategory||frame?.setWorkspaceCategoryColor?
  [...availableCategories,...categories.filter(c=>!availableCategories.some(item=>item.id===c.id))]:categories
 ).filter(c=>canReceive(c)||(c.kind==='period'&&intersects(periodInterval(c))));
 const allLanesExpanded=()=>laneCategories().every(laneExpanded);
 const lanes=$('lanes'),pinnedLanes=$('pinned-lanes');
 const viewport=$('ticks').closest('.viewport');
 let inkGesture=null;
 function paintInk(){
  inkGesture=null;
  const drawing=Boolean(frame?.drawWorkspaceStroke);
  viewport.toggleAttribute('data-pen-active',drawing);
  const strokes=frame?.workspaceInk??[];
  const markedLanes=new Set(strokes.flatMap(stroke=>stroke.map(segment=>segment.lane)));
  const layers=new Map();
  for(const track of viewport.querySelectorAll('[data-ink-lane]')){
   const row=track.parentElement,id=track.dataset.inkLane;
   row.querySelector(':scope > .swimlane-ink')?.remove();
   if(!drawing&&!markedLanes.has(id))continue;
   const layer=svg('svg',{class:'swimlane-ink',viewBox:'0 0 1000 1000',preserveAspectRatio:'none','aria-hidden':'true'});
   row.append(layer);
   layers.set(id,layer);
  }
  for(const stroke of strokes){
   let previous;
   for(const segment of stroke){
    const layer=layers.get(segment.lane);
    if(!layer){previous=undefined;continue;}
    const first=segment.points[0];
    const boundary=previous&&inkBoundary(previous.layer,previous.point,layer,first);
    if(boundary)appendInkPoint(previous.layer,previous.line,boundary[0]);
    const line=inkLine(layer,boundary?[boundary[1],...segment.points]:segment.points);
    previous={layer,line,point:segment.points.at(-1)};
   }
  }
 }
 function inkLine(layer,points){
  const line=svg('polyline',{'vector-effect':'non-scaling-stroke'});
  layer.append(line);
  drawInkLine(line,points);
  return line;
 }
 function drawInkLine(line,points){
  const coords=points.map(({time,y})=>1000*(time-start)/(end-start)+','+1000*y);
  if(coords.length===1)coords.push(coords[0]);
  line.setAttribute('points',coords.join(' '));
 }
 function appendInkPoint(layer,line,point){
  line.points.appendItem(Object.assign(layer.createSVGPoint(),{
   x:1000*(point.time-start)/(end-start),y:1000*point.y
  }));
 }
 function inkBoundary(from,first,to,last){
  if(!from||from===to)return null;
  const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
  const down=a.top<b.top;
  const edgeA=down?a.bottom:a.top,edgeB=down?b.top:b.bottom;
  if(Math.abs(edgeA-edgeB)>2)return null;
  const yA=a.top+first.y*a.height,yB=b.top+last.y*b.height;
  const fraction=yA===yB?0.5:Math.max(0,Math.min(1,((edgeA+edgeB)/2-yA)/(yB-yA)));
  const time=first.time+(last.time-first.time)*fraction;
  return [{time,y:down?1:0},{time,y:down?0:1}];
 }
 function hitInkLayer(target,x){
  const layer=target?.closest('.lane')?.querySelector(':scope > .swimlane-ink');
  const rect=layer?.getBoundingClientRect();
  return rect&&x>=rect.left&&x<rect.right?layer:null;
 }
 function addInkPoint(event,layer){
  if(!layer){inkGesture.segment=null;return;}
  const rect=layer.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const point={time:start+(event.clientX-rect.left)/rect.width*(end-start),
   y:Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height))};
  if(inkGesture.layer!==layer||!inkGesture.segment){
   const previous=inkGesture.segment?.points.at(-1);
   const boundary=previous&&inkBoundary(inkGesture.layer,previous,layer,point);
   if(boundary)appendInkPoint(inkGesture.layer,inkGesture.line,boundary[0]);
   const segment={lane:layer.parentElement.querySelector('[data-ink-lane]').dataset.inkLane,points:[point]};
   inkGesture.stroke.push(segment);
   Object.assign(inkGesture,{layer,segment,line:inkLine(layer,boundary?[boundary[1],point]:segment.points)});
   return;
  }
  const {points}=inkGesture.segment,last=points.at(-1);
  if(Math.hypot((point.time-last.time)/(end-start)*rect.width,(point.y-last.y)*rect.height)<1.5)return;
  points.push(point);
  appendInkPoint(layer,inkGesture.line,point);
 }
 viewport.addEventListener('pointerdown',event=>{
  if(!frame?.drawWorkspaceStroke||event.button!==0||!event.isPrimary)return;
  const layer=hitInkLayer(event.target,event.clientX);
  if(!layer)return;
  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);
  inkGesture={pointer:event.pointerId,stroke:[]};
  addInkPoint(event,layer);
 });
 viewport.addEventListener('pointermove',event=>{
  if(inkGesture?.pointer!==event.pointerId)return;
  addInkPoint(event,hitInkLayer(document.elementFromPoint(event.clientX,event.clientY),event.clientX));
 });
 viewport.addEventListener('pointerup',event=>{
  if(inkGesture?.pointer!==event.pointerId)return;
  addInkPoint(event,hitInkLayer(document.elementFromPoint(event.clientX,event.clientY),event.clientX));
  const {stroke}=inkGesture;
  paintInk();
  frame?.drawWorkspaceStroke?.(stroke);
 });
 viewport.addEventListener('lostpointercapture',event=>{
  if(inkGesture?.pointer===event.pointerId)paintInk();
 });
 const pinnedCategories=new Set();
 let moving=null,pendingDestination=null;
 function paintMove(){
  for(const row of viewport.querySelectorAll('[data-move-category]')){
   row.toggleAttribute('data-drop-ready',Boolean(moving&&moving.fromId!==row.dataset.moveCategory));
   row.removeAttribute('data-drop-over');
  }
  for(const grip of viewport.querySelectorAll('.room-event-move')){
   grip.setAttribute('aria-pressed',String(grip===moving?.grip));
  }
 }
 function setMove(source){
  moving=source;paintMove();
 }
 function moveTo(row){
  const {id,fromId}=moving;
  const toId=row.dataset.moveCategory;
  if(toId===fromId)return;
  setMove(null);
  pendingDestination=toId;
  if(!frame.moveWorkspaceCategory(id,fromId,toId))pendingDestination=null;
 }
 function acceptDrop(e){
  const row=e.target.closest('[data-drop-ready]');
  if(!row||!moving?.dragging)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';row.setAttribute('data-drop-over','');
 }
 viewport.addEventListener('dragenter',acceptDrop);
 viewport.addEventListener('dragover',acceptDrop);
 viewport.addEventListener('dragleave',e=>{
  const row=e.target.closest('[data-drop-over]');
  if(row&&!row.contains(e.relatedTarget))row.removeAttribute('data-drop-over');
 });
 viewport.addEventListener('drop',e=>{
  const row=e.target.closest('[data-drop-ready]');
  if(!row||!moving?.dragging)return;
  e.preventDefault();moveTo(row);
 });
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&moving){moving.grip?.focus({preventScroll:true});setMove(null);}
 });
 const labels={cause:'원인·계기',shift:'전환·변화',action:'활동·실행',succession:'계승',integration:'통합·편입',split:'분열·개편',background:'구조적 배경'};
 const kindLabel={period:'시기별 사건',arc:'사건군',theme:'주제'};
 const colorPicker=make('div','category-color-picker');
 colorPicker.id='category-color-picker';colorPicker.popover='auto';colorPicker.setAttribute('role','group');
 document.querySelector('main').append(colorPicker);
 let colorControl=null;
 colorPicker.addEventListener('toggle',()=>{
  if(!colorPicker.matches(':popover-open'))colorControl?.setAttribute('aria-expanded','false');
 });
 function categoryColor(id){
  const colors=frame?.workspaceCategoryColors;
  return colors&&Object.hasOwn(colors,id)?colors[id]:null;
 }
 function paintCategoryColors(){
  for(const element of document.querySelectorAll('[data-color-category]')){
   const color=categoryColor(element.dataset.colorCategory);
   element.toggleAttribute('data-custom-category-color',Boolean(color));
   if(color)element.style.setProperty('--category-color',color);
   else element.style.removeProperty('--category-color');
  }
 }
 function positionColorPicker(control){
  const r=control.getBoundingClientRect();
  const offset=frameTop();
  const spaceBelow=scrollHost().innerHeight-offset-r.bottom;
  const top=spaceBelow>=colorPicker.offsetHeight+6?r.bottom+6:r.top-colorPicker.offsetHeight-6;
  colorPicker.style.top=Math.max(8,-offset+8,top)+'px';
  colorPicker.style.left=Math.max(8,Math.min(r.left,document.documentElement.clientWidth-colorPicker.offsetWidth-8))+'px';
 }
 function categoryColorButton(category){
  const control=button('',()=>{
   if(colorPicker.matches(':popover-open')){
    colorPicker.hidePopover();
    colorControl.setAttribute('aria-expanded','false');
    if(colorControl===control)return;
   }
   colorControl=control;
   colorPicker.setAttribute('aria-label',category.name+' 색상');
   const current=categoryColor(category.id);
   const error=make('p','category-color-error');
   error.setAttribute('role','alert');
   const choices=[...categoryPalette,['기본색',null]].map(([label,color])=>{
    const choice=button(color?'':label,()=>{
     if(!frame.setWorkspaceCategoryColor(category.id,color)){
      error.textContent='색상을 저장하지 못했어요.';
      positionColorPicker(control);
      return;
     }
     colorPicker.hidePopover();
     control.focus({preventScroll:true});
    },color?'category-swatch':'category-color-reset');
    if(color)choice.style.setProperty('--swatch',color);
    choice.title=label;choice.setAttribute('aria-label',label);
    choice.setAttribute('aria-pressed',String(color===current));
    return choice;
   });
   colorPicker.replaceChildren(...choices,error);
   colorPicker.showPopover({source:control});
   control.setAttribute('aria-expanded','true');
   positionColorPicker(control);
   (colorPicker.querySelector('.category-swatch[aria-pressed="true"]')??choices[0]).focus({preventScroll:true});
  },'lane-color');
  control.title='카테고리 색상';
  control.setAttribute('aria-label',category.name+' 색상 변경');
  control.setAttribute('aria-controls',colorPicker.id);
  control.setAttribute('aria-expanded','false');
  control.append(icon('M14 5l5 5M8 16l-1 4 4-1L21 9a2.1 2.1 0 0 0-3-3L8 16ZM3 20h1'));
  return control;
 }
 const title=r=>r.title||r.name;
 const x=t=>Math.max(0,Math.min(plotWidth,(t-start)/(end-start)*plotWidth));
 const intersects=i=>i&&i.start<end&&i.end>start;
 const labelDate=r=>[r.date||r.start,r.end].filter(Boolean).join(' – ');
 let wheelRemainder=0,wheelFrame=0;
 function setWindow(t,months){stopSequence();anchor=t;size=months;selected='';preferred=null;wheelRemainder=0;render();}
 function panYears(years){
  const begin=monthOf(start),span=monthOf(end)-begin;
  const next=Math.max(min,Math.min(max-span,begin+years*12));
  if(next!==begin)setWindow(monthStart(next),size);
 }
 const expand=$('swimlane-fullscreen');
 const swimlaneActions=$('swimlane-actions');
 const main=document.querySelector('main');
 main.addEventListener('wheel',event=>{
  if(event.ctrlKey||event.defaultPrevented)return;
  if(!viewport.contains(event.target)&&
   (event.target!==main||!pageHeightFloor||event.clientY<viewport.getBoundingClientRect().bottom))return;
  const horizontal=Math.abs(event.deltaX)>Math.abs(event.deltaY);
  const direction=horizontal?event.deltaX:event.shiftKey?event.deltaY:0;
  if(!direction)return;
  event.preventDefault();
  if(direction<0?monthOf(start)<=min:monthOf(end)>=max){
   wheelRemainder=0;
   return;
  }
  const pixels=direction*(event.deltaMode===1?16:event.deltaMode===2?viewport.clientWidth:1);
  if(Math.sign(wheelRemainder)!==Math.sign(pixels))wheelRemainder=0;
  wheelRemainder+=pixels;
  if(wheelFrame||Math.abs(wheelRemainder)<96)return;
  wheelFrame=requestAnimationFrame(()=>{
   wheelFrame=0;
   const total=wheelRemainder;
   const years=Math.trunc(total/96);
   if(years)panYears(years);
   wheelRemainder=total%96;
  });
 },{passive:false});
 viewport.addEventListener('keydown',event=>{
  if(event.target!==viewport||event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  if(!handleSequenceKey(event)){
   event.preventDefault();
   panYears(event.key==='ArrowLeft'?-1:1);
  }
 });
 const overview=$('overview'),ruler=$('ruler'),eraOverview=$('era-overview'),viewportMark=make('i','window');
 let eraItems=[],extentStart,extentEnd;
 function renderOverview(){
  const firstYear=min/12,lastYear=max/12-1,ey=lastYear-firstYear+1;
  extentStart=monthStart(min);extentEnd=monthStart(max);
  const counts=new Map();
  for(const e of events){const y=Number(e.date.slice(0,4));counts.set(y,(counts.get(y)??0)+1);}
  const maxCount=Math.max(1,...counts.values());
  const levels=new Set(events.map(event=>event.importance));
  $('importance-key').replaceChildren(...[...importanceLabels].filter(([level])=>levels.has(level)).map(([level,label])=>make('span','level-'+level,label)));
  $('extent').textContent=firstYear+'–'+lastYear+' · 사건 '+events.length+'개';
  $('jump').min=firstYear;$('jump').max=lastYear;
  overview.replaceChildren();ruler.replaceChildren();eraOverview.replaceChildren();
  for(let y=firstYear;y<=lastYear;y++){
   const b=button('',()=>setWindow(Date.UTC(y,0),12));
   b.setAttribute('aria-label',y+'년 확대');b.title=y+'년 · 시작 사건 '+(counts.get(y)??0)+'개';
   const bar=make('i');bar.style.height=Math.max(2,Math.round((counts.get(y)??0)/maxCount*27))+'px';b.append(bar);overview.append(b);
   const step=ey>90?25:ey>24?10:5;
   if(y===firstYear||y===lastYear||(y%step===0&&y-firstYear>=ey*.07&&lastYear-y>=ey*.07)){
    const tick=make('span','',y);tick.style.left=(y===firstYear?0:y===lastYear?100:(y-firstYear+.5)/ey*100)+'%';ruler.append(tick);
   }
  }
  overview.append(viewportMark);
  eraItems=periods.filter(p=>p.start||p.end).map(p=>{
   const from=p.start?bounds(p.start).start:extentStart;
   const until=p.end?bounds(p.end).end+DAY:extentEnd;
   const b=button('',()=>{setWindow(from,36);select(p.id,anchors.get(p.id)?.[0]);},'overview-era');
   b.dataset.colorCategory=p.id;
   const dateText=value=>/^\d{4}$/.test(value)?value+'년':value;
   const dates=p.start&&p.end?dateText(p.start)+' – '+dateText(p.end):
    p.start?dateText(p.start)+'부터':dateText(p.end)+'까지';
   const caption=make('span','era-caption');
   caption.append(make('b','',p.name),make('span','era-years',dates));
   b.append(make('i','era-stroke'),caption);
   eraOverview.append(b);
   return {b,caption,from,until};
  });
  layoutEraOverview();paintCategoryColors();
 }
 function layoutEraOverview(){
  const width=eraOverview.clientWidth;
  if(!width)return;
  const items=eraItems.map(({b,caption,from,until})=>{
   const left=(from-extentStart)/(extentEnd-extentStart)*width;
   const right=(until-extentStart)/(extentEnd-extentStart)*width;
   const labelWidth=caption.getBoundingClientRect().width;
   const labelLeft=Math.min(left,width-labelWidth);
   const start=Math.min(left,labelLeft);
   const end=Math.max(right,labelLeft+labelWidth);
   b.style.marginLeft=start+'px';
   b.style.width=(end-start)+'px';
   b.style.setProperty('--bar-left',(left-start)+'px');
   b.style.setProperty('--bar-width',(right-left)+'px');
   return {b,start,end:end+8};
  });
  for(const {b,track} of packTimelineItems(items))b.style.gridRow=String(track+1);
 }
 overview.title='클릭해 연도로 이동하거나 드래그해 볼 구간을 정하세요.';
 const monthAt=clientX=>{
  const r=overview.getBoundingClientRect();
  return Math.min(max-1,Math.max(min,min+Math.floor((clientX-r.left)/r.width*(max-min))));
 };
 let drag=null,ignoreClick=false;
 overview.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  ignoreClick=false;
  const m=yearFloor(monthAt(e.clientX)),left=monthOf(start),right=monthOf(end);
  const bounds=viewportMark.getBoundingClientRect();
  const mode=Math.abs(e.clientX-bounds.left)<5?'left':Math.abs(e.clientX-bounds.right)<5?'right':
    m>=left&&m<right&&right-left<max-min?'pan':'select';
  drag={x:e.clientX,m,left,right,mode,moved:false,from:left,to:right};
 });
 overview.addEventListener('pointermove',e=>{
  if(!drag||Math.abs(e.clientX-drag.x)<4&&!drag.moved)return;
  overview.setPointerCapture(e.pointerId);
  drag.moved=true;
  const m=yearFloor(monthAt(e.clientX)),width=drag.right-drag.left;
  if(drag.mode==='pan'){
   drag.from=Math.max(min,Math.min(max-width,drag.left+m-drag.m));drag.to=drag.from+width;
  }else if(drag.mode==='left'){drag.from=Math.min(m,drag.right-12);}
  else if(drag.mode==='right'){drag.to=Math.max(m+12,drag.left+12);}
  else{drag.from=Math.min(m,drag.m);drag.to=Math.max(m,drag.m)+12;}
  Object.assign(viewportMark.style,{left:100*(drag.from-min)/(max-min)+'%',width:100*(drag.to-drag.from)/(max-min)+'%'});
 });
 overview.addEventListener('pointerup',()=>{
  if(drag?.moved){ignoreClick=true;setWindow(monthStart(drag.from),drag.to-drag.from);}
  drag=null;
 });
 overview.addEventListener('pointercancel',()=>{drag=null;render();});
 overview.addEventListener('click',e=>{if(ignoreClick){e.stopPropagation();ignoreClick=false;}},true);
 for(const [months,label] of [[0,'전체'],[120,'10년'],[36,'3년'],[12,'1년']]){
  const b=button(label,()=>{const t=intervals.get(selected)?.start;setWindow(Number.isFinite(t)?t:anchor,months);});
  b.dataset.months=months;$('zoom').append(b);
 }
 $('jump').onchange=()=>{
  if(!$('jump').value||!$('jump').validity.valid)return;
  setWindow(monthStart(Number($('jump').value)*12),12);
  $('year-panel').hidePopover();
 };
 $('prev').onclick=()=>setWindow(monthStart(Math.max(min,monthOf(start)-size)),size);
 $('next').onclick=()=>setWindow(monthStart(monthOf(end)),size);
 const toggleLanes=$('toggle-lanes');
 toggleLanes.onclick=()=>{
  stopSequence();
  expandByDefault=!allLanesExpanded();laneOverrides.clear();
  selected='';relationFocus=null;render();
 };
 $('relations').onclick=()=>open('all');
 const allEdgesButton=$('all-edges');
 allEdgesButton.onclick=()=>{
  allEdges=!allEdges;allEdgesButton.setAttribute('aria-pressed',String(allEdges));drawEdges();
 };
 function addAnchor(id,node){
  if(!anchors.has(id))anchors.set(id,[]);
  anchors.get(id).push(node);
 }
 function select(id,node){selected=id;relationFocus=null;preferred=node;paintSelection();drawEdges();}
 function openRecord(record,node){
  select(record.id,node);
  open(role.get(record.id),record);
 }
 function laneToggle(category,hasEvents){
  const active=laneExpanded(category);
  const control=button('',()=>{
   stopSequence();
   if(!laneOverrides.delete(category.id))laneOverrides.add(category.id);
   selected='';relationFocus=null;
   render();
   const next=viewport.querySelector('[data-lane-filter="'+CSS.escape(category.id)+'"]');
   (next||viewport).focus({preventScroll:true});
  },'lane-filter');
  control.dataset.laneFilter=category.id;
  control.title=active?'이 레인 접기':'이 레인 펼치기';
  if(!active){
   const status=hasEvents?'이 구간에 사건 있음':'이 구간에 사건 없음';
   control.title+=' · '+status;
   control.setAttribute('aria-description',status);
  }
  control.setAttribute('aria-label',category.name+' 보기');
  control.setAttribute('aria-expanded',String(active));
  control.append(icon(active?'M5 9l7 7 7-7':'M9 5l7 7-7 7'));
  return control;
 }
 function lanePin(category){
  const pinned=pinnedCategories.has(category.id);
  const control=button('',()=>{
   if(pinned)pinnedCategories.delete(category.id);
   else pinnedCategories.add(category.id);
   render();
   const selector='[data-lane-pin="'+CSS.escape(category.id)+'"]';
   const next=viewport.querySelector(selector)??viewport;
   if(pinnedLanes.contains(next)){
    const area=pinnedLanes.getBoundingClientRect(),button=next.getBoundingClientRect();
    if(button.bottom>area.bottom)pinnedLanes.scrollTop+=button.bottom-area.bottom;
    else if(button.top<area.top)pinnedLanes.scrollTop+=button.top-area.top;
   }
   next.focus({preventScroll:true});
  },'lane-pin');
  control.dataset.lanePin=category.id;
  control.title=pinned?'카테고리 고정 해제':'카테고리 고정';
  control.setAttribute('aria-label',category.name+' 고정');
  control.setAttribute('aria-pressed',String(pinned));
  control.append(icon('M15 4l5 5-3 1-3 4v3l-1 1-7-7 1-1h3l4-3 1-3ZM9.5 14.5L4 20'));
  return control;
 }
 function row(name,kind,record,{collapsed=false,hasEvents=false,host=lanes}={}){
  const line=make('div',collapsed?'row lane lane-collapsed':'row lane');
  const rail=record?button('',()=>{
   if(line.hasAttribute('data-drop-ready')&&!moving.dragging)moveTo(line);
   else if(collapsed||!records.has(record.id))open('category',record);
   else openRecord(record,rail);
  },'rail'):make('div','rail');
  if(kind)rail.append(make('small','',kind));
  rail.append(make('b','',name));
  if(record){
   line.dataset.categoryKind=record.kind;
   line.dataset.colorCategory=record.id;
   if(frame?.moveWorkspaceCategory&&canReceive(record)&&availableCategories.some(c=>c.id===record.id))line.dataset.moveCategory=record.id;
   if(!collapsed){rail.dataset.record=record.id;addAnchor(record.id,rail);}
   const heading=make('div','rail-with-filter');
   const actions=make('div','lane-actions');
   if(frame?.setWorkspaceCategoryColor)actions.append(categoryColorButton(record));
   actions.append(lanePin(record),laneToggle(record,hasEvents));
   heading.append(rail,actions);
   line.append(heading);
  }else line.append(rail);
  host.append(line);
  const track=make('div',collapsed?'track lane-preview':'track');line.append(track);
  if(record)track.dataset.inkLane=record.id;
  if(!collapsed)for(const [index,tick] of ticks.entries()){
   const grid=make('i',index%2?'tick shaded':'tick');
   const left=x(tick.t);
   grid.style.left=left+'px';grid.style.width=x(ticks[index+1]?.t??end)-left+'px';track.append(grid);
  }
  return track;
 }
 function periodLane(){
  const track=row('시기','',null,{host:$('periods')});track.classList.add('era-track');
  track.dataset.inkLane='';
  track.parentElement.dataset.categoryKind='period';
  const items=periods.map(p=>({p,...periodInterval(p)})).filter(intersects);
  if(!items.length){track.append(make('span','no-period','이 구간에 등록된 시기 없음'));return;}
  const packed=packTimelineItems(items);
  track.style.minHeight=29*Math.max(...packed.map(item=>item.track+1))+8+'px';
  for(const item of packed){
   const {p,track:level}=item;
   const bar=button(p.name,()=>openRecord(p,bar),'era');
   bar.dataset.colorCategory=p.id;
   bar.dataset.record=p.id;bar.title=p.name+' '+labelDate(p);bar.setAttribute('aria-label',bar.title);
   Object.assign(bar.style,{left:x(item.start)+'px',width:Math.max(3,x(item.end)-x(item.start))+'px',top:5+level*29+'px'});
   track.append(bar);addAnchor(p.id,bar);
  }
 }
 function eventButton(record){
  const mark=button('',()=>openRecord(record,mark),'event');
  mark.dataset.record=record.id;
  const kind=record.end?'기간':'시점';
  const level=importanceLabels.get(record.importance);
  if(level)mark.dataset.importance=record.importance;
  mark.title=[kind,labelDate(record),title(record),level].filter(Boolean).join(' · ');
  mark.setAttribute('aria-label',mark.title);
  mark.append(make('b','',title(record)));
  return mark;
 }
 function drawBand(track,heading,items,category){
  if(!items.length)return;
  const section=make('section','lane-band');
  section.append(make('h3','band-heading',heading));
  const body=make('div','band-items');
  section.append(body);track.append(section);
  const blocks=[],years=new Map();
  for(const r of items){
   const date=r.date||r.start;
   const mark=eventButton(r);
   let card=mark;
   if(frame?.hideWorkspaceEvent&&role.get(r.id)==='event'){
    card=make('div','room-event-card');
    card.dataset.workspaceEvent=r.sourceId||r.id;
    const hide=button('×',()=>frame.hideWorkspaceEvent?.(r.sourceId||r.id),'room-event-hide');
    hide.title='이 방에서 숨기기';hide.setAttribute('aria-label',title(r)+' 숨기기');
    card.append(mark);
    if(frame.moveWorkspaceCategory){
     const source={id:r.sourceId||r.id,fromId:category?.id};
     const grip=button('',()=>setMove(moving?.grip===grip?null:{...source,grip}),'room-event-move');
     grip.title='분류 이동 · 드래그하거나 눌러서 레인 선택';
     grip.setAttribute('aria-label',title(r)+' 분류 이동');
     grip.append(icon('M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'));
     card.draggable=true;grip.draggable=true;mark.draggable=false;
     card.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/plain',source.id);e.dataTransfer.effectAllowed='move';
      setMove({...source,dragging:true});
     });
     card.addEventListener('dragend',()=>setMove(null));
     card.append(grip);
    }
    card.append(hide);
   }
   const interval=intervals.get(r.id),left=x(interval.start),right=x(interval.end);
   if(!r.end&&/^\d{4}$/.test(date)){
    if(!years.has(date)){
     const group=make('div','year-events');group.append(make('h4','',date+'년'));
     body.append(group);
     const width=Math.min(plotWidth,Math.max(132,Math.min(240,right-left-6)));
     const groupLeft=Math.min(left,plotWidth-width);
     group.style.width=width+'px';group.style.left=groupLeft+'px';
     years.set(date,group);blocks.push({node:group,start:groupLeft,end:groupLeft+width+5});
    }
    years.get(date).append(card);addAnchor(r.id,mark);continue;
   }
   const duration=Boolean(r.end);
   const when=eventMonthLabel(r);
   if(when)mark.append(make('small','when',when));
   mark.classList.add(duration?'span-event':'point-event');
   body.append(card);addAnchor(r.id,mark);
   const width=card.offsetWidth;
   // A month-only record belongs to its month, without implying a specific day.
   const point=date.length===7?(left+right)/2:left;
   const dotX=Math.max(4,Math.min(point,plotWidth-4));
   const labelLeft=Math.max(0,Math.min(duration?left:dotX-8,plotWidth-width));
   card.style.left=labelLeft+'px';
   if(duration){
    const pin=make('i','pin duration');
    pin.setAttribute('aria-hidden','true');mark.append(pin);
    pin.style.left=(left-labelLeft)+'px';
    pin.style.width=Math.max(2,right-left)+'px';
    pin.classList.toggle('continues',interval.end>end);
    pin.classList.toggle('began-earlier',interval.start<start);
   }else{
    const dot=make('i','date-dot');
    dot.setAttribute('aria-hidden','true');dot.style.left=(dotX-labelLeft)+'px';mark.append(dot);
   }
   blocks.push({node:card,start:duration?Math.min(labelLeft,left):Math.min(labelLeft,dotX-4),
    end:Math.max(labelLeft+width,duration?right:dotX+4)+5,above:duration?0:13});
  }
  const packed=packTimelineItems(blocks);
  const heights=[],headroom=[];
  for(const {node,track:level,above=0} of packed){
   heights[level]=Math.max(heights[level]||0,node.offsetHeight);
   headroom[level]=Math.max(headroom[level]||0,above);
  }
  const offsets=[];let height=4;
  for(const [level,h] of heights.entries()){
   height+=headroom[level];offsets.push(height);height+=h+9;
  }
  for(const {node,track:level} of packed)node.style.top=offsets[level]+'px';
  body.style.height=height+'px';
 }
 function drawEventDots(track,events){
  if(!events.length)return;
  const points=events.map(event=>{
   const {start:from,end:until}=intervals.get(event.id);
   const hasDay=/^\d{4}-\d{2}-\d{2}$/.test(event.date);
   const point=event.end||hasDay?x(from):(x(from)+x(until))/2;
   const center=Math.max(3,Math.min(plotWidth-3,point));
   return {center,start:center-4,end:center+4};
  });
  const packed=packTimelineItems(points);
  const dots=make('div','lane-preview-dots');
  dots.setAttribute('aria-hidden','true');
  dots.style.height=(1+Math.max(...packed.map(item=>item.track)))*9+'px';
  for(const point of packed){
   const dot=make('i');
   dot.style.left=point.center+'px';
   dot.style.top=point.track*9+'px';
   dots.append(dot);
  }
  track.append(dots);
 }
 function drawLane(name,kind,record,items){
  const expanded=!record||laneExpanded(record);
  const visible=items.filter(r=>intersects(intervals.get(r.id)));
  if(!record&&!visible.length)return;
  const host=pinnedCategories.has(record?.id)?pinnedLanes:lanes;
  const track=row(name,kind,record,{collapsed:!expanded,hasEvents:visible.length>0,host});
  if(!expanded){drawEventDots(track,visible);return;}
  if(!visible.length){
   track.classList.add('quiet');
   return;
  }
  const actor=role.get(visible[0].id)==='actor';
  drawBand(track,actor?'존속 시작':'시점 사건',visible.filter(r=>!r.end),record);
  drawBand(track,actor?'존속 기간':'기간 사건',visible.filter(r=>r.end),record);
 }
 const drawnEndpoints=new Map();
 function drawEdges(){
  drawnEndpoints.clear();
  const layer=$('edges');layer.replaceChildren();
  const defs=svg('defs',{});layer.append(defs);
  for(const [id,color] of [['normal','#487a70'],['active','#a94929']]){
   const tip=svg('marker',{id,viewBox:'0 0 10 10',refX:10,refY:5,markerWidth:8,markerHeight:8,markerUnits:'userSpaceOnUse',orient:'auto'});
   tip.append(svg('path',{d:'M0 0 L10 5 L0 10Z',fill:color}));defs.append(tip);
   const dot=svg('marker',{id:id+'-start',viewBox:'0 0 8 8',refX:4,refY:4,markerWidth:7,markerHeight:7,markerUnits:'userSpaceOnUse'});
   dot.append(svg('circle',{cx:4,cy:4,r:3,fill:color}));defs.append(dot);
  }
  const origin=layer.getBoundingClientRect(),boxes=new Map();
  function box(node){
   if(!boxes.has(node)){
    const r=(node.matches('.rail')?node.querySelector('b'):node).getBoundingClientRect();
    boxes.set(node,{left:r.left-origin.left,right:r.right-origin.left,top:r.top-origin.top,bottom:r.bottom-origin.top});
   }
   return boxes.get(node);
  }
  const pinnedBounds=pinnedLanes.getBoundingClientRect();
  const candidates=id=>(selected===id&&preferred?.isConnected?[preferred]:anchors.get(id)||[]).filter(node=>{
   if(!pinnedLanes.contains(node))return true;
   const rect=node.getBoundingClientRect();
   return rect.bottom>pinnedBounds.top&&rect.top<pinnedBounds.bottom;
  });
  const isActive=r=>relationFocus?.relationIds.has(r.id)||selected===r.fromId||selected===r.toId;
  const drawOrder=r=>r.id===relationFocus?.id?2:Number(isActive(r));
  const links=[];
  const pending=new Set(sequence?.steps.slice(sequence.index).map(step=>step.id));
  for(const rel of [...relations].sort((a,b)=>drawOrder(a)-drawOrder(b))){
   if((!allEdges&&!isActive(rel))||pending.has(rel.fromId)||pending.has(rel.toId))continue;
   const sources=candidates(rel.fromId),targets=candidates(rel.toId);
   let nearest=Infinity,pair;
   for(const from of sources)for(const to of targets){
    const a=box(from),b=box(to);
    const distance=Math.hypot((a.left+a.right-b.left-b.right)/2,(a.top+a.bottom-b.top-b.bottom)/2);
    if(distance>=nearest)continue;
    nearest=distance;
    pair={from,to};
   }
   if(!pair){
    const from=sources[0],to=targets[0];
    if((!from&&rel.fromType!=='event')||(!to&&rel.toType!=='event')||(!from&&!to))continue;
    pair={from,to};
   }
   drawnEndpoints.set(rel,pair);
   const {from,to}=pair;
   const group=from?.closest('.year-events');
   const sameGroup=!!group&&group===to?.closest('.year-events');
   links.push({id:rel.id,rel,from:from&&box(from),to:to&&box(to),sameGroup});
  }
  const paths=cardRelationPaths(links,origin.width);
  const labelBounds={
   left:$('ticks').getBoundingClientRect().left-origin.left+2,right:origin.width-2,
   top:Math.max(heading.getBoundingClientRect().bottom,-frameTop())-origin.top+2,
   bottom:Math.min(origin.bottom,scrollHost().innerHeight-frameTop())-origin.top-2
  };
  let occupied,fallbackRelation;
  for(const [i,{rel,from,to}] of links.entries()){
   const d=paths[i];
   const pressed=rel.id===relationFocus?.id;
   const active=isActive(rel),marker=active?'active':'normal';
   const style=!from||!to?'partial ':rel.status==='draft'?'draft ':'';
   const path=svg('path',{class:'edge '+style+(active?'focus':selected||relationFocus?'muted':''),d,'marker-end':'url(#'+marker+')','data-relation':rel.id});
   if(from)path.setAttribute('marker-start','url(#'+marker+'-start)');
   const hit=svg('path',{class:'edge-hit',d,role:'button',tabindex:0,'data-relation':rel.id,'aria-pressed':String(pressed),'aria-label':rel.fromName+' → '+rel.toName});
   hit.onclick=()=>{
    relationFocus=pressed?null:{id:rel.id,...relationChain(relations,rel)};
    selected='';preferred=null;
    paintSelection();drawEdges();
    layer.querySelector('.edge-hit[data-relation="'+CSS.escape(rel.id)+'"]')?.focus({preventScroll:true});
   };
   hit.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!e.repeat)hit.onclick();}};
   layer.append(path,hit);
   if(pressed||(!relationFocus&&active)){
    occupied??=[...viewport.querySelectorAll('.band-items > :is(.event,.room-event-card,.year-events)')].map(box);
    const mid=path.getPointAtLength(path.getTotalLength()/2);
    const name=labels[rel.kind]||rel.label||'관계';
    const label=svg('text',{class:'edge-label'});label.textContent=name;layer.append(label);
    const width=Math.ceil(label.getComputedTextLength()),size=28,gap=5,textInset=3;
    const position=placeRelationLabel(mid,width+textInset*2+(pressed?size+gap:0),size,labelBounds,occupied);
    if(!position){
     label.remove();
     if(pressed)fallbackRelation={rel,name};
     continue;
    }
    occupied.push(position);
    const {left,top}=position;
    label.setAttribute('x',left+textInset+width/2);
    label.setAttribute('y',top+18);
    if(pressed){
     const holder=svg('foreignObject',{x:left+textInset*2+width+gap,y:top,width:size,height:size});
     const detail=button('+',()=>{detail.focus({preventScroll:true});open('relation',rel);},'edge-detail');
     detail.setAttribute('aria-label','관계 상세 보기');detail.setAttribute('aria-haspopup','dialog');
     holder.append(detail);layer.append(holder);
    }
   }
  }
  const panel=$('selection');
  const previous=panel.querySelector('.relation-fallback');
  if(previous?.dataset.relation!==fallbackRelation?.rel.id){
   previous?.remove();
   if(fallbackRelation){
    const {rel,name}=fallbackRelation;
    const fallback=make('div','selection-head relation-fallback');
    fallback.dataset.relation=rel.id;
    fallback.append(make('b','',name),button('관계 상세 보기',()=>open('relation',rel)));
    panel.append(fallback);
   }
  }
 }
 const sequenceControls=$('sequence');
 const play=button('',()=>{
  if(!sequence||sequence.index===sequence.steps.length)startSequence();
  else if(sequence.timer)pauseSequence();
  else resumeSequence();
 },'sequence-play');
 const back=button('←',()=>{pauseSequence();stepSequence(-1);});
 const forward=button('→',()=>{pauseSequence();stepSequence(1);});
 const finish=button('모두 보기',()=>{
  stopSequence();paintSequence();drawEdges();play.focus({preventScroll:true});
 });
 const progress=make('span','sequence-count');
 back.setAttribute('aria-label','이전 사건으로');forward.setAttribute('aria-label','다음 사건 보기');
 progress.setAttribute('aria-live','polite');
 sequenceControls.append(play,back,progress,forward,finish);
 sequenceControls.addEventListener('keydown',handleSequenceKey);
 function handleSequenceKey(event){
  if(!sequence||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||
   (event.key!=='ArrowLeft'&&event.key!=='ArrowRight'))return false;
  event.preventDefault();pauseSequence();stepSequence(event.key==='ArrowLeft'?-1:1);
  return true;
 }
 function revealSteps(){
  const steps=[];
  for(const [id,nodes] of anchors){
   if(role.get(id)!=='event')continue;
   const cards=nodes.filter(node=>node.matches('.event')).map(node=>node.closest('.room-event-card')||node);
   if(cards.length)steps.push({id,time:intervals.get(id).start,nodes:cards});
  }
  return steps.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 }
 function playEntrance(){
  if(reducedMotion.matches)return;
  const steps=revealSteps(),gap=Math.min(90,1200/Math.max(1,steps.length));
  for(const [index,step] of steps.entries())for(const node of step.nodes)riseIn(node,index*gap);
 }
 function paintSequence(){
  const shown=sequence?.index??0,total=sequence?.steps.length??0;
  play.textContent=!sequence?'▶ 순서대로 보기':sequence.timer?'❚❚ 멈춤':shown===total?'↺ 처음부터':'▶ 이어 보기';
  play.disabled=!sequence&&!events.some(event=>intervals.get(event.id)?.start>=start&&intersects(intervals.get(event.id)));
  for(const node of [back,progress,forward,finish])node.hidden=!sequence;
  progress.textContent=shown+' / '+total;
  back.disabled=!shown;forward.disabled=shown>=total;
  viewport.setAttribute('aria-description',sequence?'좌우 화살표 키로 이전 또는 다음 사건 보기':'좌우 화살표 키로 한 해씩 이동');
  for(const node of viewport.querySelectorAll('.waiting,[data-now]')){
   node.classList.remove('waiting');node.removeAttribute('data-now');
  }
  if(!sequence)return;
  for(const [index,step] of sequence.steps.entries())for(const node of step.nodes){
   node.classList.toggle('waiting',index>=shown);
   node.toggleAttribute('data-now',index===shown-1);
  }
  for(const group of viewport.querySelectorAll('.year-events')){
   group.classList.toggle('waiting',[...group.querySelectorAll('.event')].every(node=>(node.closest('.room-event-card')||node).classList.contains('waiting')));
  }
 }
 function stepSequence(direction){
  const next=sequence.index+direction;
  if(next<0||next>sequence.steps.length)return;
  sequence.index=next;
  if(next===sequence.steps.length)pauseSequence();
  paintSequence();drawEdges();
  if(!next)return;
  const {nodes}=sequence.steps[next-1];
  if(direction>0)for(const node of nodes)riseIn(node);
  nodes[0].scrollIntoView({block:'nearest',inline:'nearest',behavior:reducedMotion.matches?'instant':'smooth'});
 }
 function resumeSequence(){
  if(sequence.index>=sequence.steps.length||sequence.timer)return;
  sequence.timer=setInterval(()=>stepSequence(1),1150);
  paintSequence();
 }
 function pauseSequence(){
  if(!sequence?.timer)return;
  clearInterval(sequence.timer);sequence.timer=0;paintSequence();
 }
 function stopSequence(){
  clearInterval(sequence?.timer);sequence=null;
 }
 function startSequence(){
  stopSequence();
  expandByDefault=true;laneOverrides.clear();
  selected='';relationFocus=null;
  sequence={steps:[],index:0,timer:0};
  render();
  if(sequence.steps.length){stepSequence(1);resumeSequence();}
  else{stopSequence();paintSequence();drawEdges();}
 }
 function follow(id,node){
  const r=records.get(id);if(!r)return;
  node??=anchors.get(id)?.[0];
  if(!node){
   const i=intervals.get(id);
   if(!i){open(role.get(id),r);return;}
   setWindow(Number.isFinite(i.start)?i.start:i.end-DAY,size);node=anchors.get(id)?.[0];
  }
  if(!node){open(role.get(id),r);return;}
  select(id,node);
  node.scrollIntoView({block:'center',inline:'nearest'});
 }
 function paintSelection(){
  const panel=$('selection');panel.replaceChildren();
  for(const node of viewport.querySelectorAll('button[data-record]')){
   node.setAttribute('aria-pressed',String(node.dataset.record===selected));
   node.toggleAttribute('data-chain',relationFocus?.recordIds.has(node.dataset.record)??false);
  }
  const r=records.get(selected);if(!r)return;
  const head=make('div','selection-head');head.append(make('small','',labelDate(r)),make('b','',title(r)),button('상세 보기',()=>open(role.get(selected),r)));
  const related=relations.filter(rel=>rel.fromId===selected||rel.toId===selected);
  panel.append(head);
  if(related.length){
   const nav=make('div','neighbors');
   for(const rel of related){
    const out=rel.fromId===selected,other=out?rel.toId:rel.fromId;
    const peer=records.get(other),i=intervals.get(other);
    const where=i?.end<=start?'이전 구간 · ':i?.start>=end?'다음 구간 · ':'';
    const word=labels[rel.kind]||rel.label||'관계';
    nav.append(button(where+(out?'→ ':'← ')+(peer?title(peer):out?rel.toName:rel.fromName)+' · '+word,()=>peer?follow(other,drawnEndpoints.get(rel)?.[out?'to':'from']):open('relation',rel)));
   }
   panel.append(nav);
  }
 }
 function drawTimeline(){
  const span=Math.min(size||max-min,max-min);
  const focus=Math.min(Math.max(monthOf(anchor),min),max-1);
  const begin=Math.max(min,Math.min(yearFloor(focus),max-span));
  start=monthStart(begin);end=monthStart(begin+span);
  plotWidth=$('ticks').clientWidth;if(plotWidth<30)return;
  $('relations').textContent='전체 관계 '+relations.length+'건';
  const firstYear=begin/12,lastYear=(begin+span)/12-1;
  $('range').textContent=firstYear===lastYear?firstYear+'년':firstYear+' — '+lastYear+'년';
  $('pick-year').setAttribute('aria-label',$('range').textContent+' · 연도 선택');
  $('jump').value=Math.floor(focus/12);$('prev').disabled=begin<=min;$('next').disabled=begin+span>=max;
  for(const b of $('zoom').children)b.setAttribute('aria-pressed',String(+b.dataset.months===size));
  Object.assign(viewportMark.style,{left:100*(begin-min)/(max-min)+'%',width:100*span/(max-min)+'%'});
  ticks=[];
  const step=12*Math.ceil(span/12/Math.max(3,Math.floor(plotWidth/70)));
  for(let m=begin;m<begin+span;m+=step)ticks.push({t:monthStart(m),label:m/12+'년'});
  viewport.classList.toggle('yearly',step===12);
  $('ticks').replaceChildren();for(const tick of ticks){if(plotWidth-x(tick.t)<34&&tick.t!==start)continue;
   const el=span===12?make('span','',tick.label):button(tick.label,()=>setWindow(tick.t,12),'axis-jump');
   el.style.left=x(tick.t)+2+'px';$('ticks').append(el);}
  if(colorPicker.matches(':popover-open'))colorPicker.hidePopover();
  const pinnedScroll=pinnedLanes.scrollTop;
  lanes.replaceChildren();pinnedLanes.replaceChildren();$('periods').replaceChildren();anchors=new Map();preferred=null;
  const displayedCategories=laneCategories();
  const categoriesById=new Map(displayedCategories.map(category=>[category.id,category]));
  const pinned=[...pinnedCategories].reverse().map(id=>categoriesById.get(id)).filter(Boolean);
  const unpinned=displayedCategories.filter(category=>!pinnedCategories.has(category.id));
  const periodRows=unpinned.filter(category=>category.kind==='period');
  const otherRows=unpinned.filter(category=>category.kind!=='period');
  toggleLanes.hidden=!displayedCategories.length;
  const showAll=allLanesExpanded();
  const toggleLabel=showAll?'모두 접기':'모두 펼치기';
  toggleLanes.querySelector('span').textContent=toggleLabel;
  toggleLanes.querySelector('path').setAttribute('d',showAll?'M7 5l5 4 5-4M7 19l5-4 5 4':'M7 9l5-4 5 4M7 15l5 4 5-4');
  toggleLanes.title=toggleLabel;
  toggleLanes.setAttribute('aria-label',toggleLabel);
  toggleLanes.setAttribute('aria-expanded',String(showAll));
  periodLane();
  for(const c of [...pinned,...periodRows,...otherRows]){
   const items=events.filter(e=>{
    const names=c.kind==='period'?eventPeriods(e):c.kind==='arc'?e.arcs:e.themes;
    return e.categoryIds?.includes(c.id)??names.includes(c.name);
   });
   drawLane(c.name,kindLabel[c.kind],c,items);
  }
  pinnedLanes.scrollTop=pinnedScroll;
  if(showAll){
   drawLane('미분류','',null,events.filter(e=>!e.arcs.length&&!e.themes.length&&!eventPeriods(e).length));
   drawLane('존속 시작일','관계 주체',null,actors.filter(a=>a.start));
   if(!events.some(e=>intersects(intervals.get(e.id))))$('lanes').append(make('p','empty','이 구간에 기록된 수업 사건이 없습니다.'));
  }
  if(moving?.grip&&!moving.grip.isConnected)moving=null;
  if(sequence){
   sequence.steps=revealSteps().filter(step=>step.time>=start);
   sequence.index=Math.min(sequence.index,sequence.steps.length);
   if(sequence.index===sequence.steps.length){clearInterval(sequence.timer);sequence.timer=0;}
  }
  paintSequence();
  paintCategoryColors();paintMove();paintSelection();drawEdges();paintInk();
  const range=start+'-'+end;
  if(fontsReady&&range!==animatedRange){
   animatedRange=range;
   if(!sequence)playEntrance();
  }
 }
 const heading=$('timeline-heading');
 let pageHeightFloor=0,headingShift=0,edgeFrame=0;
 function setPageHeightFloor(height){
  const floor=Math.max(0,Math.ceil(height));
  if(floor===pageHeightFloor)return;
  pageHeightFloor=floor;
  main.style.minHeight=floor?floor+'px':'';
 }
 function pageHeightToViewportBottom(){
  return scrollHost().innerHeight-frameTop()-main.getBoundingClientRect().top;
 }
 function fitFrame(){
  if(ownsScroll())return;
  frame.style.height=Math.ceil(main.getBoundingClientRect().height+3)+'px';
  if(embed.outerFrame){
   const {outerFrame,showroom}=embed;
   const border=outerFrame.offsetHeight-outerFrame.clientHeight;
   outerFrame.style.height=Math.ceil(showroom.getBoundingClientRect().height+border)+'px';
  }
 }
 function pinControls(){
  const top=frameTop();
  const rect=viewport.getBoundingClientRect();
  heading.style.setProperty('--timeline-top',Math.max(0,-top)+'px');
  pinnedLanes.style.maxHeight=Math.min(320,Math.round(scrollHost().innerHeight*.4))+'px';
  const overhang=Math.max(0,Math.ceil(rect.bottom+top-scrollHost().innerHeight));
  swimlaneActions.style.setProperty('--fullscreen-overhang',overhang+'px');
  const shift=heading.getBoundingClientRect().top-rect.top;
  if(shift===headingShift)return;
  headingShift=shift;
  scheduleEdges();
 }
 function scheduleEdges(){
  if(!edgeFrame)edgeFrame=requestAnimationFrame(()=>{
   edgeFrame=0;
   const id=document.activeElement?.matches('.edge-hit')&&document.activeElement.dataset.relation;
   drawEdges();
   if(id)$('edges').querySelector('.edge-hit[data-relation="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
  });
 }
 function onViewportChange(){
  const height=pageHeightToViewportBottom();
  if(height<pageHeightFloor){setPageHeightFloor(height);fitFrame();}
  pinControls();
 }
 function render(position){
  const host=scrollHost(),{scrollX,scrollY}=position??host;
  // Keep the scroll position reachable without extending the table below its lanes.
  setPageHeightFloor(scrollY>0?pageHeightToViewportBottom()+scrollY-host.scrollY:0);
  drawTimeline();fitFrame();
  if(host.scrollX!==scrollX||host.scrollY!==scrollY)host.scrollTo({left:scrollX,top:scrollY,behavior:'instant'});
  pinControls();
 }
 const listening=new AbortController();
 pinnedLanes.addEventListener('scroll',scheduleEdges,{passive:true,signal:listening.signal});
 for(const host of new Set([window,embed?.scrollWindow].filter(Boolean))){
  host.addEventListener('scroll',onViewportChange,{passive:true,signal:listening.signal});
  host.addEventListener('resize',onViewportChange,{signal:listening.signal});
 }
 window.addEventListener('pagehide',()=>{pauseSequence();listening.abort();},{once:true});
 let fullInPage=false,returnScroll;
 function syncFullscreen(){
  const wasActive=root.classList.contains('swimlane-expanded');
  const active=fullInPage||document.fullscreenElement===root;
  root.classList.toggle('swimlane-expanded',active);
  frame?.classList.toggle('swimlane-expanded',fullInPage);
  const label=active?'전체 화면 닫기':'전체 화면';
  expand.setAttribute('aria-label',label);expand.title=label;
  expand.replaceChildren(icon(active?'M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5':'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5'));
  render(active===wasActive?undefined:active?{scrollX:0,scrollY:0}:returnScroll);
 }
 if(!frame||frame.allowFullscreen){
  expand.hidden=false;
  expand.onclick=async()=>{
   if(fullInPage){fullInPage=false;syncFullscreen();}
   else if(document.fullscreenElement===root)await document.exitFullscreen();
   else {
    const {scrollX,scrollY}=scrollHost();
    returnScroll={scrollX,scrollY};
    if(document.fullscreenEnabled){
     try{await root.requestFullscreen();return;}catch{/* Fill the tab if the browser denies its fullscreen API. */}
    }
    fullInPage=true;syncFullscreen();
   }
   expand.focus({preventScroll:true});
  };
  document.addEventListener('fullscreenchange',syncFullscreen);
  document.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&fullInPage&&!e.defaultPrevented&&!readerDialogOpen()){
    fullInPage=false;syncFullscreen();expand.focus({preventScroll:true});
   }
  });
 }
 function readerDialogOpen(){
  return document.querySelector('#reader[open]')||document.querySelector(':popover-open');
 }
 if(frame){
  frame.redrawSwimlaneInk=paintInk;
  frame.redrawSwimlaneColors=paintCategoryColors;
  frame.redrawSwimlane=()=>{moving=null;pendingDestination=null;render();};
  frame.updateSwimlaneLesson=lesson=>{
   stopSequence();
   if(document.querySelector('#reader[open]'))reader.close();
   ({events,categories,actors,relations,periods,availableCategories=categories}=lesson);
   indexLesson();
   reader=setupSwimlaneModal(lesson,frame);
   if(!records.has(selected))selected='';
   relationFocus=null;
   const destination=availableCategories.find(c=>c.id===pendingDestination);
   if(destination&&!laneExpanded(destination)){
    if(expandByDefault)laneOverrides.delete(destination.id);
    else laneOverrides.add(destination.id);
   }
   renderOverview();render();
   pendingDestination=null;
  };
 }
 $('status').textContent='';renderOverview();syncFullscreen();
 new ResizeObserver(()=>{if($('ticks').clientWidth!==plotWidth)render();fitFrame();}).observe(main);
 new ResizeObserver(layoutEraOverview).observe(eraOverview);
 document.fonts.ready.then(()=>{fontsReady=true;layoutEraOverview();render();});
}
init().catch(error=>{$('status').textContent='스윔레인을 불러오지 못했습니다. '+error.message;});
