// Everyword review policy: calendar-day evidence + FSRS, not number of sessions.
// Pure functions: no browser or account dependencies.
export function localDay(value){
  if(!value)return '';
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
export function daysApart(older,newer){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(older||'')||!/^\d{4}-\d{2}-\d{2}$/.test(newer||''))return NaN;
  const parse=s=>Date.UTC(Number(s.slice(0,4)),Number(s.slice(5,7))-1,Number(s.slice(8,10)));
  return Math.round((parse(newer)-parse(older))/86400000);
}
export function distinctStudyDays(card){
  const days=new Set();
  for(const event of card?.history||[]){
    if(event?.practice===true)continue;
    const d=localDay(event?.at);
    if(d)days.add(d);
  }
  if(card?.lastScheduledStudyDay)days.add(card.lastScheduledStudyDay);
  return [...days].sort();
}
function eligibleByCalendar(card,day){
  const days=distinctStudyDays(card);
  if(!days.length)return true;
  // Conservative cross-day checkpoints. A series of sessions on one
  // calendar day NEVER advances these stages.
  // 1st -> next day; 2nd -> after 2 days; 3rd -> after 4; 4th -> after 7.
  const gaps=[1,2,4,7];
  if(days.length>=5)return false;
  const elapsed=daysApart(days.at(-1),day);
  return Number.isFinite(elapsed)&&elapsed>=gaps[days.length-1];
}
export function hasScheduledToday(card,day){
  return card?.lastScheduledStudyDay===day||localDay(card?.fsrs?.last_review)===day;
}
export function dailyReviewSelection(cards,day,olderCount=10){
  const active=(cards||[]).filter(c=>c&&!c.deletedAt);
  const required=[],remaining=[];
  const reasons={new:0,hard:0,scheduled:0,calendar:0,older:0};
  for(const c of active){
    // Already completed today: no repeat in subsequent daily batches.
    if(hasScheduledToday(c,day))continue;
    const isNew=!c.fsrs;
    const hard=c.difficult===true;
    // Every card with an FSRS due date on this or a previous calendar day.
    const scheduled=!!c.fsrs?.due&&localDay(c.fsrs.due)<=day;
    const calendar=!isNew&&eligibleByCalendar(c,day);
    if(isNew||hard||scheduled||calendar){
      required.push(c);
      if(isNew)reasons.new++;
      if(hard)reasons.hard++;
      if(scheduled)reasons.scheduled++;
      if(calendar)reasons.calendar++;
    }else remaining.push(c);
  }
  // Supplement with older items even when their FSRS next due is further away.
  // Prefer items not seen today, then those not seen for the longest period.
  remaining.sort((a,b)=>{
    const da=distinctStudyDays(a).at(-1)||'',db=distinctStudyDays(b).at(-1)||'';
    const seenA=da===day?1:0,seenB=db===day?1:0;
    if(seenA!==seenB)return seenA-seenB;
    if(da!==db)return da.localeCompare(db);
    return String(a.id).localeCompare(String(b.id));
  });
  const extra=remaining.slice(0,Math.max(0,olderCount));
  reasons.older=extra.length;
  return {cards:[...required,...extra],required:required.length,reasons};
}
