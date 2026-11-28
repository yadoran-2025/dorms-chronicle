import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import '../sheets.js';
import '../history.js';
import {countryFlag} from '../assets/country-flag.js';
import {buildSwimlane, eventMonthLabel, lessonSwimlane, matchSwimlaneEvents, packTimelineItems, placeRelationLabel, pointRelationPath, cardRelationPaths, relationChain} from '../swimlane-data.js';

test('sheet events retain an optional end date and reject an inverted range', () => {
  const event = {사건ID: 'E1', 날짜: '1910', 종료일: '1918', 사건명: '토지 조사 사업', 주제: '정책', 중요도: ' core '};
  const tables = {
    events: [event, {사건ID: 'E2', 날짜: '1919-03-01', 사건명: '3·1운동', 주제: '정책'}],
    categories: [{카테고리ID: 'T1', 패키지ID: 'japan', 카테고리명: '정책', 카테고리유형: 'theme'}],
    actors: [], participants: [], relations: []
  };
  const events = buildSwimlane(tables, SheetData, 'japan').events;
  assert.deepEqual(events.map(({end}) => end), ['1918', '']);
  assert.deepEqual(events.map(({importance}) => importance), ['core', '']);
  event.종료일 = '1909';
  assert.throws(() => buildSwimlane(tables, SheetData, 'japan'), /토지 조사 사업의 시작일과 종료일/);
});

test('the local swimlane covers the full package and its drawable relation endpoints', () => {
  const {events, categories, periods, actors, relations} = JSON.parse(
    readFileSync(new URL('../assets/swimlane-japan.json', import.meta.url), 'utf8')
  );
  const ids = new Set(events.map(event => event.id));
  const periodIds = new Set(periods.map(period => period.id));
  const labels = new Set(categories.map(category => category.name));
  const years = events.map(event => Number(event.date.slice(0, 4)));
  assert.equal(ids.size, events.length);
  assert.equal(events.find(event => event.title === '토지 조사 사업')?.end, '1918');
  assert.deepEqual([Math.min(...years), Math.max(...years)], [1910, 1945]);
  assert.ok(events.every(event => [...event.arcs, ...event.themes].every(name => labels.has(name))));
  assert.ok(relations.length > 0 && relations.every(record => record.visible));
  const endpoints = {event: ids, category: periodIds, actor: new Set(actors.filter(actor => actor.start).map(actor => actor.id))};
  assert.ok(relations.every(record =>
    endpoints[record.fromType]?.has(record.fromId) && endpoints[record.toType]?.has(record.toId)));
});

test('swimlane tracks separate overlapping labels and reuse space once it is free', () => {
  const items = [{start: 18, end: 30}, {start: 1, end: 18}, {start: 5, end: 20}];
  assert.deepEqual(packTimelineItems(items).map(({track}) => track), [0, 1, 0]);
});

test('cold-war and colonial events stay in their registered packages', () => {
  const tables = {
    events: [{사건ID: 'E1', 날짜: '1945', 사건명: '냉전 사건', 시기: '냉전의 시작'},
      {사건ID: 'E2', 날짜: '1910', 사건명: '식민지 사건', 시기: '무단 통치'}],
    categories: [{카테고리ID: 'P1', 패키지ID: 'cold-war', 카테고리명: '냉전의 시작', 카테고리유형: 'period'},
      {카테고리ID: 'P2', 패키지ID: 'japan', 카테고리명: '무단 통치', 카테고리유형: 'period'}],
    relations: [{관계ID: 'R1', 패키지ID: 'cold-war', 출발유형: 'event', 출발ID: 'E1', 도착유형: 'category', 도착ID: 'P1'},
      {관계ID: 'R2', 패키지ID: 'japan', 출발유형: 'event', 출발ID: 'E2', 도착유형: 'category', 도착ID: 'P2'}],
    actors: [], participants: []
  };
  const coldWar = buildSwimlane(tables, SheetData, 'cold-war');
  assert.deepEqual(coldWar.events.map(event => event.id), ['E1']);
  assert.deepEqual(coldWar.periods.map(period => period.id), ['P1']);
  assert.deepEqual(coldWar.relations.map(({id, visible}) => [id, visible]), [['R1', true]]);
  assert.deepEqual(buildSwimlane(tables, SheetData, 'japan').events.map(event => event.id), ['E2']);
});

test('swimlane uses explicit memberships and resolves all three types of space links', () => {
  const tables = {
    events:[{사건ID:'E1',날짜:'1962',사건명:'봉쇄'},{사건ID:'E2',날짜:'1962',사건명:'다른 패키지'}],
    categories:[{카테고리ID:'T',패키지ID:'cold-war',카테고리명:'쿠바위기',카테고리유형:'arc'}],
    categoryLinks:[{event_id:'E2',topic_id:'T'}],
    packageLinks:[{사건ID:'E1',패키지ID:'cold-war'}],
    actors:[{주체ID:'A',주체명:'쿠바', '존속 시작일':'1902'}],
    participants:[{사건ID:'E1',주체ID:'A',역할:'participant'}],
    relations:[{관계ID:'R1',패키지ID:'cold-war',출발유형:'actor',출발ID:'A',도착유형:'event',도착ID:'E1'}],
    spaces:[{공간ID:'S',공간명:'쿠바'},{공간ID:'W',공간명:'미주'}],
    eventSpaces:[{사건ID:'E1',공간ID:'S'}], actorSpaces:[{주체ID:'A',공간ID:'W'}], categorySpaces:[{카테고리ID:'T',공간ID:'W'}]
  };
  const result = buildSwimlane(tables,SheetData,'cold-war');
  assert.deepEqual(result.events.map(event => [event.id,event.arcs,event.place,event.actors.length]),[['E1',[],'쿠바',1]]);
  assert.equal(result.actors[0].place,'미주');
  assert.equal(result.categories[0].place,'미주');
});

test('relation arrows approach the destination dot from a clear side', () => {
  const from = {x: 40, y: 90, labelSide: 1};
  assert.match(pointRelationPath(from, {x: 360, y: 55, labelSide: 1}), / 251 55 351 55$/);
  assert.match(pointRelationPath(from, {x: 60, y: 220, labelSide: 1}), / 60 [\d.]+ 60 211$/);
  assert.match(pointRelationPath(from, {x: 360, y: 55, labelSide: -1}), / 360 [\d.]+ 360 64$/);
});

test('relation labels and detail buttons use free space around the cards', () => {
  const bounds = {left:100, right:550, top:40, bottom:300};
  const card = {left:220, right:340, top:90, bottom:152};
  const upperCard = {...card, top:40, bottom:85};
  const middle = {x:280, y:120};
  assert.deepEqual(placeRelationLabel(middle, 88, 28, bounds, [card]), {
    left:236, right:324, top:58, bottom:86,
  });
  assert.deepEqual(placeRelationLabel(middle, 88, 28, bounds, [card, upperCard]), {
    left:236, right:324, top:156, bottom:184,
  });
  assert.equal(placeRelationLabel(middle, 88, 28, bounds, [bounds]), null);
});

test('focus arrows meet facing card borders in the recorded direction', () => {
  const a = {left: 10, right: 110, top: 10, bottom: 50};
  const b = {...a, left: 150, right: 250};
  const below = {...a, top: 90, bottom: 130};
  const cardRelationPath = (from,to,width,sameGroup=false) => cardRelationPaths([{id:'r',from,to,sameGroup}],width)[0];
  assert.equal(cardRelationPath(a, b, 300), 'M 110 30 C 130 30 130 30 150 30');
  assert.equal(cardRelationPath(b, a, 300), 'M 150 30 C 130 30 130 30 110 30');
  assert.equal(cardRelationPath(below, a, 300), 'M 60 90 C 60 70 60 70 60 50');
  const next = {...a, top: 50, bottom: 90};
  assert.equal(cardRelationPath(a, next, 300, true), 'M 110 30 C 128 30 128 70 110 70');
  assert.equal(cardRelationPath(next, a, 110, true), 'M 10 70 C 1 70 1 30 10 30');
});

test('incoming and outgoing arrows have independent, stable slots on the same card border', () => {
  const a = {left: 20, right: 100, top: 10, bottom: 50};
  const b = {...a, top: 120, bottom: 160};
  const c = {...b, left: 0, right: 60};
  const links = [{id:'1',from:a,to:b}, {id:'2',from:b,to:a}, {id:'3',from:c,to:a}];
  const paths = cardRelationPaths(links, 300);
  const ends = paths.map(path => path.match(/-?[\d.]+/g).map(Number));
  assert.deepEqual(ends.map((p,i)=>i===0?p.slice(0,2):p.slice(-2)), [[60,50],[82,50],[38,50]]);
  assert.notEqual(ends[0][6], ends[1][0]);
  assert.deepEqual(cardRelationPaths([...links].reverse(),300).reverse(), paths);
});

test('a selected arrow traces earlier and later links without pulling in side branches', () => {
  const selected = {id:'selected',fromId:'B',toId:'C'};
  const relations = [selected,
    {id:'earlier',fromId:'A',toId:'B'},
    {id:'later',fromId:'C',toId:'D'},
    {id:'cycle',fromId:'D',toId:'C'},
    {id:'other-result',fromId:'B',toId:'E'},
    {id:'other-cause',fromId:'F',toId:'C'}];
  const chain = relationChain(relations, selected);
  assert.deepEqual(chain.relationIds, new Set(['selected','earlier','later','cycle']));
  assert.deepEqual(chain.recordIds, new Set(['A','B','C','D']));
});

test('an arrow with one visible card keeps its direction and stays close to that card', () => {
  const card = {left:80,right:140,top:20,bottom:40};
  const atRight = {...card,left:240,right:290};
  const links = [{id:'out',from:card},{id:'in',to:card},{id:'out-at-edge',from:atRight}];
  assert.deepEqual(cardRelationPaths(links,300),['M 140 30 H 164','M 56 30 H 80','M 240 30 H 216']);
});

test('lesson lanes and relations use only the displayed events and their selected topics',()=>{
  const data={topics:[{topic_id:'t',name:'선택'},{topic_id:'other',name:'제외'}],actors:[],
    events:[{id:'E2',legacyId:'old',date:'1940',title:'시트 사건',description:'내용',directTopicIds:['t'],actorIds:[]}]};
  const sheet={categories:[],events:[{id:'old',row:4}],actors:[{id:'a'},{id:'b'}],relations:[
    {fromId:'a',fromType:'actor',toId:'old',toType:'event'},
    {fromId:'old',fromType:'event',toId:'excluded',toType:'event'}]};
  const result=lessonSwimlane(data,new Map([['t',{type:'period'}]]),sheet);
  assert.deepEqual(result.events.map(e=>[e.title,e.period,e.row]),[['시트 사건','선택',4]]);
  assert.deepEqual(result.categories.map(c=>c.id),['t']);
  assert.deepEqual(result.actors.map(a=>a.id),['a']);
  assert.equal(result.relations.length,1);
  assert.deepEqual(lessonSwimlane(data,new Map(),null).events[0].themes,['선택']);
});

test('a room keeps swimlane relations to hidden events without restoring their cards',()=>{
  const event={date:'1940',title:'보이는 사건',directTopicIds:[],actorIds:[]};
  const shown={...event,id:'shown'};
  const hidden={...event,id:'uuid',legacyId:'hidden',title:'숨긴 사건'};
  const another={...event,id:'another',title:'다른 숨긴 사건'};
  const sourceEvents=[shown,hidden,another];
  const link=(id,fromId,toId)=>({id,fromId,toId,fromType:'event',toType:'event'});
  const sheet={events:[shown,{id:'hidden'},another],categories:[],actors:[],relations:[
    link('out','shown','hidden'),link('in','hidden','shown'),link('both-hidden','hidden','another'),link('outside','shown','outside')]};
  const data={events:[shown],topics:[],actors:[]};
  const lesson=lessonSwimlane(data,new Map(),sheet,undefined,sourceEvents);
  assert.deepEqual(lesson.events.map(event=>event.id),['shown']);
  assert.deepEqual(lesson.relations,[]);
  assert.deepEqual(lesson.partialRelations.map(rel=>rel.id),['out','in']);
  const restored=lessonSwimlane({...data,events:sourceEvents},new Map(),sheet);
  assert.deepEqual(restored.relations.map(rel=>rel.id),['out','in','both-hidden']);
  assert.deepEqual(restored.partialRelations,[]);
});

test('a saved lesson opens the unique sheet event and keeps its image and participant details',()=>{
  const event={id:'uuid',title:'사건',date:'1940',directTopicIds:[],actorIds:['p'],media:[{url:'https://example.com/image'}]};
  const data={events:[event],topics:[],actors:[{actor_id:'p',name:'참여자'}]};
  const row={id:'E1',title:'사건',date:'1940'};
  const sheet={events:[row],categories:[],actors:[],relations:[]};
  const lesson=lessonSwimlane(data,new Map(),sheet);
  assert.equal(matchSwimlaneEvents(data.events,sheet.events)({...event}),row);
  assert.deepEqual([lesson.events[0].sourceId,lesson.events[0].id,lesson.events[0].media],['uuid','E1',event.media[0].url]);
  assert.deepEqual(lesson.detailActors.map(actor=>actor.id),['p']);
  assert.deepEqual(lesson.actors,[]);
  sheet.events.push({...row,id:'E2'});
  assert.equal(lessonSwimlane(data,new Map(),sheet).events[0].id,'uuid');
});

test('lesson reader receives participant roles and the verified terms overlapping the event period',()=>{
  const countries=[{actor_id:'actor_gdr',name:'동독',actor_type:'state'},{actor_id:'org',name:'기구',actor_type:'organization'}];
  const term=(date,status)=>({actorId:'actor_gdr',status,start:SheetData.dateRange(date),end:null});
  const tenures=[term('1959','verified'),term('1962','verified'),term('1959','draft')];
  const event={id:'E1',title:'기간 사건',date:'1958',endDate:'1960',directTopicIds:[],actorIds:['actor_gdr']};
  const sheet={actors:[],categories:[],relations:[],events:[{id:'E1',actors:[{id:'actor_gdr',name:'동독',role:'participant'}]}]};
  const lesson=lessonSwimlane({events:[event],actors:countries,topics:[],tenures},new Map(),sheet);
  assert.equal(lesson.events[0].actors[0].role,'participant');
  assert.deepEqual(lesson.leadership.countries,[countries[0]]);
  const bounds={start:SheetData.dateRange(event.date).start,end:SheetData.dateRange(event.endDate).end};
  assert.deepEqual(HistoryViews.leadersDuring(lesson.leadership.tenures,'actor_gdr',bounds),[tenures[0]]);
  assert.equal(countryFlag(countries[0],'1959-09').src,'/assets/flags/de.svg');
  assert.equal(countryFlag(countries[0],'1959-10').src,'/assets/flags/gdr.webp');
});

test('a card shows its month, or its years when it spans more than one', () => {
  assert.equal(eventMonthLabel({date: '1919-03-01'}), '3월');
  assert.equal(eventMonthLabel({date: '1920-10'}), '10월');
  assert.equal(eventMonthLabel({date: '1911'}), '');
  assert.equal(eventMonthLabel({date: '1910', end: '1918'}), '1910–1918');
  assert.equal(eventMonthLabel({start: '1919-04', end: '1932-05'}), '1919–1932');
  assert.equal(eventMonthLabel({date: '1920-06', end: '1920-10'}), '6–10월');
  assert.equal(eventMonthLabel({date: '1926-06-10', end: '1926-06-12'}), '6월');
  assert.equal(eventMonthLabel({date: '1929', end: '1929'}), '');
});
