import {localLesson,readLessonSheet} from './assets/local-sheet-copy.js';

export const relationTypes = ['cause','shift','action','integration','split','background'];

export const importanceLabels = new Map([['core','핵심·전환점'],['major','주요 사건'],['detail','심화·보충']]);

export async function loadSwimlane(config, parser, packageId, request = readLessonSheet) {
  const sources = [
    ['events','사건',['사건ID','날짜','사건명']],
    ['categories','카테고리',['카테고리ID','패키지ID','카테고리명','카테고리유형']],
    ['relations','관계',['관계ID','패키지ID','출발ID','도착ID','출발유형','도착유형']],
    ['actors','주체',['주체ID','주체명']],
    ['participants','사건_주체',['사건ID','주체ID','역할']]
  ];
  if (config.sheetIds) sources.push(
    ['packageLinks','사건_패키지',['사건ID','패키지ID']],
    ['spaces','공간',['공간ID','공간명']],
    ['eventSpaces','사건_공간',['사건ID','공간ID']],
    ['actorSpaces','주체_공간',['주체ID','공간ID']],
    ['categorySpaces','카테고리_공간',['카테고리ID','공간ID']]
  );
  const entries = await Promise.all(sources.map(async ([key, name, required]) => {
    const [header = [], ...rows] = parser.parseCSV(await parser.sheetCSV(config,name,request),true);
    if (!required.every(field => header.includes(field))) throw Error(`${name} 탭의 열을 확인해 주세요.`);
    return [key, rows.flatMap((cells, index) => cells.some(Boolean) ? [{
      ...Object.fromEntries(header.flatMap((field, i) => field ? [[field, cells[i] ?? '']] : [])),
      row: index + 2
    }] : [])];
  }));
  const tables = Object.fromEntries(entries);
  if (tables.events.length && !['시기', '사건군', '주제', '카테고리ID'].some(key => key in tables.events[0])) {
    tables.categoryLinks = await parser.readCategoryLinks(config, request);
  }
  const data = buildSwimlane(tables, parser, packageId);
  // Local copies saved before the column existed keep their rows and manual refresh behavior.
  if (localLesson && tables.events.length && !Object.hasOwn(tables.events[0], '중요도') && ['cold-war','japan'].includes(packageId)) {
    try {
      const response = await fetch('/assets/swimlane-' + packageId + '.json');
      if (response.ok) {
        const snapshot = await response.json();
        const levels = new Map(snapshot.events.map(event => [event.id, event.importance]));
        for (const event of data.events) event.importance = levels.get(event.id) || '';
      }
    } catch { /* The cached events also work without importance metadata. */ }
  }
  return data;
}

export function buildSwimlane(tables, parser, packageId) {
  const allPackages = packageId == null;
  const inPackage = row => allPackages || row.패키지ID === packageId;
  const members = tables.packageLinks && new Set(tables.packageLinks.filter(row => row.패키지ID === packageId).map(row => row.사건ID));
  const places = (links,field) => parser.linkedSpaceNames(tables.spaces || [],links || [],field);
  const eventPlaces = places(tables.eventSpaces,'사건ID');
  const actorPlaces = places(tables.actorSpaces,'주체ID');
  const categoryPlaces = places(tables.categorySpaces,'카테고리ID');
  const namesOfPlaces = (byId,id,legacy) => [...(byId.get(id) || [])].join(', ') || legacy || '';
  const catalog = tables.categories.map(row => ({
    topic_id: row.카테고리ID, name: row.카테고리명, category_type: row.카테고리유형
  }));
  const categories = tables.categories.filter(inPackage).map(row => ({
    id: row.카테고리ID, name: row.카테고리명, kind: row.카테고리유형,
    ...(allPackages ? {packageId: row.패키지ID} : {}),
    source:row.출처,start: row.시작일, end: row.종료일, body: row.설명, place: namesOfPlaces(categoryPlaces,row.카테고리ID,row.주공간), row: row.row
  }));
  const categoriesById = new Map(categories.map(record => [record.id, record]));
  const memberships = new Map();
  for (const {event_id, topic_id} of tables.categoryLinks ?? parser.categoryLinks(tables.events, catalog)) {
    const category = categoriesById.get(topic_id);
    if (!category) continue;
    if (!memberships.has(event_id)) memberships.set(event_id, []);
    memberships.get(event_id).push(category);
  }
  const actorNames = new Map(tables.actors.map(row => [row.주체ID, row.주체명]));
  const eventActors = new Map();
  const includesEvent = id => id && (allPackages || (members || memberships).has(id));
  for (const row of tables.participants) {
    if (!includesEvent(row.사건ID) || !actorNames.has(row.주체ID)) continue;
    if (!eventActors.has(row.사건ID)) eventActors.set(row.사건ID, []);
    eventActors.get(row.사건ID).push({id:row.주체ID, name:actorNames.get(row.주체ID), role:row.역할});
  }
  const events = tables.events.filter(row => includesEvent(row.사건ID)).map(row => {
    const end = row.종료일?.trim() || '';
    if (!allPackages) {
      const start = parser.dateRange(row.날짜);
      if (end && parser.dateRange(end).end < start.start) throw Error(`${row.사건명}의 시작일과 종료일을 확인해 주세요.`);
    }
    const categories = memberships.get(row.사건ID) || [];
    const names = kind => categories.filter(category => category.kind === kind).map(category => category.name);
    return {
      id: row.사건ID, row: row.row, date: row.날짜, end, title: row.사건명, type: row.사건유형, importance: (row.중요도 || '').trim(),
      period: names('period')[0] || '', periodNames:names('period'), arcs: names('arc'), themes: names('theme'),
      categoryIds:categories.map(c=>c.id),source:row.출처,body: row.내용, media: row.이미지, place: namesOfPlaces(eventPlaces,row.사건ID,row.공간), actors: eventActors.get(row.사건ID) || []
    };
  });
  if (!events.length) throw Error('패키지에 연결된 연표 자료를 찾지 못했습니다.');
  const periods = categories.filter(record => record.kind === 'period');
  for (const period of allPackages ? [] : periods) {
    const start = period.start ? parser.dateRange(period.start).start : -Infinity;
    const end = period.end ? parser.dateRange(period.end).end : Infinity;
    if (start > end) throw Error(`${period.name}의 시작일과 종료일을 확인해 주세요.`);
  }
  const eventNames = new Map(tables.events.map(row => [row.사건ID, row.사건명]));
  const names = {event: eventNames, actor: actorNames, category: new Map(tables.categories.map(row => [row.카테고리ID, row.카테고리명]))};
  const packageRelations = tables.relations.filter(inPackage);
  const actorIds = new Set(packageRelations.flatMap(row =>
    ['출발', '도착'].filter(side => row[side + '유형'] === 'actor').map(side => row[side + 'ID'])));
  const participantIds = new Set(events.flatMap(event => event.actors.map(actor => actor.id)));
  const detailActors = tables.actors.filter(row => row.주체ID && (allPackages || actorIds.has(row.주체ID) || participantIds.has(row.주체ID))).map(row => {
    const start = row['존속 시작일'] || '';
    if (start && !allPackages) parser.dateRange(start);
    return {id: row.주체ID, title: row.주체명, start, end: row['존속 종료일'], body: row.소개, kind: row.구분, originalName:row.원어명,iso3:row.국가코드,
      orientation:row.성향,status:row.검토상태,periodNotes:row['기간 설명'],
      place: namesOfPlaces(actorPlaces,row.주체ID,row.거점공간)};
  });
  const actors = detailActors.filter(actor => actorIds.has(actor.id));
  const plotted = {
    event: new Set(events.map(event => event.id)),
    category: new Set(periods.map(period => period.id)),
    actor: new Set(actors.filter(actor => actor.start).map(actor => actor.id))
  };
  const relations = packageRelations.map(row => ({
    id: row.관계ID, row: row.row, kind: row.관계유형, label: row.라벨, body: row.설명, source: row.출처, status: row.검토상태,
    fromType: row.출발유형, fromId: row.출발ID, fromName: names[row.출발유형]?.get?.(row.출발ID) || row.출발ID,
    toType: row.도착유형, toId: row.도착ID, toName: names[row.도착유형]?.get?.(row.도착ID) || row.도착ID,
    visible: Boolean(plotted[row.출발유형]?.has?.(row.출발ID) && plotted[row.도착유형]?.has?.(row.도착ID))
  }));
  return {events, categories, periods, actors, detailActors, relations};
}

export function swimlaneDateRange(value, dateRange) {
  const decade = /^(\d{3})0s$/.exec(value);
  if (!decade) return dateRange(value);
  return {...dateRange(decade[1] + '0'), end: dateRange(decade[1] + '9').end};
}

export function packTimelineItems(items) {
  const ends = [];
  return [...items].sort((a, b) => a.start - b.start).map(item => {
    const available = ends.findIndex(end => end <= item.start);
    const track = available === -1 ? ends.length : available;
    ends[track] = item.end;
    return {...item, track};
  });
}

export function placeRelationLabel(point, width, height, bounds, obstacles) {
  if (bounds.right - bounds.left < width || bounds.bottom - bounds.top < height) return null;
  const x = point.x - width / 2, y = point.y - height / 2;
  const gap = 4;
  const candidates = [[x, y], ...obstacles.flatMap(box => [
    [box.left - width - gap, y], [box.right + gap, y],
    [x, box.top - height - gap], [x, box.bottom + gap],
  ])].map(([left, top]) => {
    left = Math.max(bounds.left, Math.min(left, bounds.right - width));
    top = Math.max(bounds.top, Math.min(top, bounds.bottom - height));
    return {left, top, right:left + width, bottom:top + height};
  });
  const distance = box => (box.left - x) ** 2 + (box.top - y) ** 2;
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates.find(a => obstacles.every(b =>
    a.right + gap <= b.left || b.right + gap <= a.left ||
    a.bottom + gap <= b.top || b.bottom + gap <= a.top
  )) ?? null;
}

export function pointRelationPath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const direction = Math.sign(dx) || 1;
  const rise = Math.sign(dy) || -1;
  const across = Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy);
  const leaveSide = across && from.labelSide === -direction;
  const enterSide = across && to.labelSide === direction;
  const sameSide = across && !leaveSide && !enterSide && Math.abs(dy) < 20;
  const approach = sameSide ? rise : -rise;
  const startX = from.x + (leaveSide ? 9 * direction : 0);
  const startY = from.y + (leaveSide ? 0 : 9 * rise);
  const endX = to.x - (enterSide ? 9 * direction : 0);
  const endY = to.y + (enterSide ? 0 : 9 * approach);
  const horizontal = Math.min(Math.abs(endX - startX) * .38, 100);
  const vertical = Math.min(Math.abs(endY - startY) * .44 + (across ? 18 : 0), 75);
  const controlX1 = startX + (leaveSide ? horizontal * direction : 0);
  const controlY1 = startY + (leaveSide ? 0 : vertical * rise);
  const controlX2 = endX - (enterSide ? horizontal * direction : 0);
  const controlY2 = endY + (enterSide ? 0 : vertical * approach);
  return `M ${startX} ${startY} C ${controlX1} ${controlY1} ${controlX2} ${controlY2} ${endX} ${endY}`;
}

// Use the actual rendered card as the key: an event may appear in several lanes.
export function cardRelationPaths(links, width) {
  const ports = new Map();
  function port(card, side, peer, id) {
    let sides = ports.get(card);
    if (!sides) ports.set(card, sides = new Map());
    if (!sides.has(side)) sides.set(side, []);
    const verticalEdge = side === 'left' || side === 'right';
    const low = verticalEdge ? 'top' : 'left', high = verticalEdge ? 'bottom' : 'right';
    const point = {id, peer: (peer[low] + peer[high]) / 2, at: (card[low] + card[high]) / 2, span: card[high] - card[low]};
    sides.get(side).push(point);
    return point;
  }
  const routes = links.map(({from: a, to: b, sameGroup, id}) => {
    if (!a || !b) {
      const card = a || b;
      const right = width - card.right;
      const room = 24;
      const useRight = a ? right >= room || right >= card.left : card.left < room && right > card.left;
      const side = useRight ? 'right' : 'left';
      const start = card[side];
      const end = useRight ? Math.min(width - 1, start + room) : Math.max(1, start - room);
      return {stub: port(card, side, card, id), start: a ? start : end, end: a ? end : start};
    }
    const gapX = Math.max(b.left - a.right, a.left - b.right);
    const gapY = Math.max(b.top - a.bottom, a.top - b.bottom);
    let fromSide, toSide, via;
    if (gapX >= 8 && gapX >= gapY) {
      fromSide = a.right <= b.left ? 'right' : 'left';
      toSide = fromSide === 'right' ? 'left' : 'right';
    } else if (gapY >= 12 && !sameGroup) {
      fromSide = a.bottom <= b.top ? 'bottom' : 'top';
      toSide = fromSide === 'bottom' ? 'top' : 'bottom';
    } else if (gapX >= 0 && !sameGroup) {
      const top = Math.min(a.top, b.top), bottom = Math.max(a.bottom, b.bottom);
      fromSide = toSide = top >= 18 ? 'top' : 'bottom';
      via = fromSide === 'top' ? top - 18 : bottom + 18;
    } else {
      const left = Math.min(a.left, b.left), right = Math.max(a.right, b.right);
      fromSide = toSide = width - right >= Math.min(20, left) ? 'right' : 'left';
      via = fromSide === 'right' ? Math.min(width - 1, right + 18) : Math.max(1, left - 18);
    }
    return {horizontal: fromSide === 'left' || fromSide === 'right', start: a[fromSide], end: b[toSide],
      via: via ?? (a[fromSide] + b[toSide]) / 2, source: port(a, fromSide, b, id), target: port(b, toSide, a, id)};
  });
  for (const sides of ports.values()) for (const group of sides.values()) {
    if (group.length < 2) continue;
    // Sort by the opposite card to avoid crossing. A shared ID tie-break keeps
    // reciprocal arrows in the same order at both ends.
    group.sort((a, b) => a.peer - b.peer || a.id.localeCompare(b.id));
    const spacing = Math.min(22, group[0].span * .8 / (group.length - 1));
    group.forEach((p, i) => { p.at += (i - (group.length - 1) / 2) * spacing; });
  }
  return routes.map(({stub, horizontal, start, end, via, source, target}) => {
    if (stub) return `M ${start} ${stub.at} H ${end}`;
    const xy = (normal, tangent) => horizontal ? normal + ' ' + tangent : tangent + ' ' + normal;
    return `M ${xy(start, source.at)} C ${xy(via, source.at)} ${xy(via, target.at)} ${xy(end, target.at)}`;
  });
}

export function relationChain(relations, edge) {
  const relationIds = new Set([edge.id]);
  const recordIds = new Set();
  for (const [start, match, next] of [[edge.fromId, 'toId', 'fromId'], [edge.toId, 'fromId', 'toId']]) {
    const byRecord = new Map();
    for (const relation of relations) {
      const id = relation[match];
      if (!byRecord.has(id)) byRecord.set(id, []);
      byRecord.get(id).push(relation);
    }
    const visited = new Set();
    const pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      recordIds.add(id);
      for (const relation of byRecord.get(id) || []) {
        relationIds.add(relation.id);
        pending.push(relation[next]);
      }
    }
  }
  return {relationIds, recordIds};
}

export function matchSwimlaneEvents(events, rows = []) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const key = ({date, title}) => JSON.stringify([date, title]);
  function uniqueByDateAndTitle(records) {
    const matches = new Map();
    for (const record of records) {
      const id = key(record);
      matches.set(id, matches.has(id) ? undefined : record);
    }
    return matches;
  }
  const source = uniqueByDateAndTitle(rows);
  const targets = uniqueByDateAndTitle(events);
  return event => byId.get(event.id) || byId.get(event.legacyId) ||
    (targets.get(key(event))?.id === event.id ? source.get(key(event)) : undefined);
}

export function lessonSwimlane(data, metadata, sheet, actorRelationIds = new Set(), sourceEvents = data.events) {
  const used = new Set(data.events.flatMap(event => event.directTopicIds));
  const sheetCategories = new Map(sheet?.categories.map(category => [category.id, category]));
  /** @type {{id:string,name:string,kind:string,start?:string,end?:string}[]} */
  const availableCategories = data.topics.map(topic => {
    const info = metadata.get(topic.topic_id);
    const row = sheetCategories.get(topic.topic_id);
    return {...row, id:topic.topic_id, name:topic.name, kind:info?.type || row?.kind || 'theme',
      start:info?.startDate || row?.start, end:info?.endDate || row?.end};
  });
  const categories = availableCategories.filter(topic => used.has(topic.id));
  const byId = new Map(categories.map(category => [category.id, category]));
  const matchEvent = matchSwimlaneEvents(sourceEvents, sheet?.events);
  const names = new Map(data.actors.map(actor => [actor.actor_id, actor.name]));
  const events = data.events.map(event => {
    // Older saved lessons used UUIDs before the sheet adopted short event IDs.
    const row = matchEvent(event);
    const topics = event.directTopicIds.map(id => byId.get(id)).filter(Boolean);
    const labels = kind => topics.filter(topic => topic.kind === kind).map(topic => topic.name);
    return {...row, id:row?.id || event.id, sourceId:event.id, legacyId:event.legacyId, title:event.title, date:event.date, end:event.endDate || '',
      media:row?.media || (event.media || []).map(image=>image.url).join('\n'), images:event.media,
      source:event.source, originLabel:event.originLabel,
      body:event.description, type:event.eventType, place:event.place || row?.place,
      categoryIds:topics.map(t=>t.id),period:labels('period')[0] || '', periodNames:labels('period'), arcs:labels('arc'), themes:labels('theme'),
      actors:row?.actors || event.actorIds.filter(id => names.has(id)).map(id => ({id,name:names.get(id)}))};
  });
  const selected = new Set([...events, ...categories].map(record => record.id));
  const relations = (sheet?.relations || []).filter(rel =>
    ((selected.has(rel.fromId) || selected.has(rel.toId)) ||
     (rel.fromType === 'actor' && rel.toType === 'actor' && actorRelationIds.has(rel.fromId) && actorRelationIds.has(rel.toId))) &&
    (rel.fromType === 'actor' || selected.has(rel.fromId)) &&
    (rel.toType === 'actor' || selected.has(rel.toId)));
  const related = new Set(relations.flatMap(rel => [rel.fromId, rel.toId]));
  const actors = (sheet?.actors || []).filter(actor => related.has(actor.id)).map(actor => ({...actor}));
  const visibleIds = new Set([...selected, ...actors.map(actor => actor.id)]);
  const hiddenEvents = new Set(sourceEvents.map(event => matchEvent(event)?.id || event.id).filter(id => !visibleIds.has(id)));
  const partialRelations = (sheet?.relations || []).filter(rel =>
    (visibleIds.has(rel.fromId) && rel.toType === 'event' && hiddenEvents.has(rel.toId)) ||
    (visibleIds.has(rel.toId) && rel.fromType === 'event' && hiddenEvents.has(rel.fromId)));
  const participantNames=new Set(events.flatMap(event=>event.actors.map(actor=>actor.name)));
  const detailActors=new Map(data.actors.filter(actor=>participantNames.has(actor.name))
    .map(actor=>[actor.actor_id,{id:actor.actor_id,title:actor.name,kind:actor.actor_type}]));
  for(const actor of sheet?.detailActors || sheet?.actors || []){
    if(related.has(actor.id)||participantNames.has(actor.title))detailActors.set(actor.id,actor);
  }
  return {events, categories, availableCategories, actors, leadership:{countries:data.actors.filter(a=>a.actor_type==='state'),tenures:data.tenures||[]}, detailActors:[...detailActors.values()], relations:relations.map(rel => ({...rel})), partialRelations, periods:categories.filter(c => c.kind === 'period')};
}

export function eventPeriods(event){
  return event.periodNames ?? (event.period ? [event.period] : []);
}

// The time axis shows years only, so each card carries its own month.
// A span inside one year reads as months; a longer one reads as years.
export function eventMonthLabel(record){
  const from = record.date || record.start || '', until = record.end || '';
  const month = value => Number(value.slice(5, 7));
  if (!until) return month(from) ? month(from) + '월' : '';
  if (from.slice(0, 4) !== until.slice(0, 4)) return [from.slice(0, 4), until.slice(0, 4)].filter(Boolean).join('–');
  if (!month(from) || !month(until)) return '';
  return month(from) === month(until) ? month(from) + '월' : month(from) + '–' + month(until) + '월';
}
