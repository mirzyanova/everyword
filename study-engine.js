// Everyword lesson engine. Each word appears once in each direction before
// additional repetitions; keep the directions well separated when possible.
export function shuffled(items,random=Math.random){
  const result=[...items];
  for(let i=result.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}
export function makeLesson(cards,kind,random=Math.random){
  const records={};
  for(const c of cards)records[c.id]={
    ru:{correct:0,required:1,first:null,asked:0},
    en:{correct:0,required:1,first:null,asked:0},
    misses:0
  };
  // Randomize the cards independently of their original order and date of import.
  // Separate RU and EN presentations by several different words, rather than
  // placing two sides of one word next to each other by chance.
  const firstOrder=shuffled(cards,random);
  const firstSide=new Map();
  const firstTasks=[];
  const sides={ru:0,en:0};
  for(const c of firstOrder){
    const previous=firstTasks.at(-1)?.side;
    const beforePrevious=firstTasks.at(-2)?.side;
    let side=random()<.5?'ru':'en';
    if((side===previous&&side===beforePrevious)||sides[side]>sides[side==='ru'?'en':'ru']+1){
      side=side==='ru'?'en':'ru';
    }
    sides[side]++;
    firstSide.set(c.id,side);
    firstTasks.push({id:c.id,side});
  }
  const remaining=shuffled(firstOrder,random);
  const secondTasks=[];
  const spacing=Math.min(6,Math.floor(cards.length/2));
  while(remaining.length){
    const position=cards.length+secondTasks.length;
    const eligible=remaining.filter(c=>{
      const firstIndex=firstOrder.findIndex(x=>x.id===c.id);
      return position-firstIndex>spacing;
    });
    const choices=eligible.length?eligible:remaining;
    const allSoFar=[...firstTasks,...secondTasks];
    const previous=allSoFar.at(-1)?.side;
    const beforePrevious=allSoFar.at(-2)?.side;
    // Prefer variety, but not mechanical RU/EN alternation.
    const opposite=choices.filter(c=>firstSide.get(c.id)===previous);
    const mustChange=previous===beforePrevious;
    const pool=(mustChange||random()<.60)&&opposite.length?opposite:choices;
    const picked=pool[Math.floor(random()*pool.length)];
    secondTasks.push({id:picked.id,side:firstSide.get(picked.id)==='ru'?'en':'ru'});
    remaining.splice(remaining.findIndex(c=>c.id===picked.id),1);
  }
  return {kind,records,tasks:[...firstTasks,...secondTasks],answerCount:0,cardIds:cards.map(c=>c.id),completed:false,recent:[]};
}
export function answerLesson(lesson,remembered,random=Math.random){
  if(!lesson||lesson.completed||!lesson.tasks.length)return null;
  const task=lesson.tasks.shift();
  const record=lesson.records[task.id];
  if(!record)return null;
  const side=record[task.side];
  if(side.first===null)side.first=!!remembered;
  side.asked++;
  lesson.answerCount++;
  if(remembered)side.correct++;
  else {
    record.misses++;
    // Three successful recalls AFTER the latest miss in this direction.
    side.correct=0;
    side.required=3;
  }
  lesson.recent=Array.isArray(lesson.recent)?lesson.recent:[];
  lesson.recent.push(task.id);
  if(lesson.recent.length>6)lesson.recent.shift();
  const pending=side.correct<side.required;
  if(pending){
    const delay=Math.min(6,Math.max(2,Math.floor(lesson.cardIds.length/4)),lesson.tasks.length);
    const candidates=[];
    for(let i=delay;i<=lesson.tasks.length;i++){
      const prev=lesson.tasks.slice(Math.max(0,i-5),i).map(t=>t.id);
      const next=lesson.tasks.slice(i,i+5).map(t=>t.id);
      // Prefer placements far from another presentation of this same word.
      const score=Math.min(
        prev.lastIndexOf(task.id)<0?6:prev.length-1-prev.lastIndexOf(task.id),
        next.indexOf(task.id)<0?6:next.indexOf(task.id)
      );
      candidates.push({i,score});
    }
    const best=Math.max(...candidates.map(x=>x.score));
    const options=candidates.filter(x=>x.score>=Math.max(0,best-1));
    const position=options[Math.floor(random()*options.length)].i;
    lesson.tasks.splice(position,0,task);
  }
  // Never show the same word back-to-back if another word is available.
  if(lesson.tasks.length>1&&lesson.tasks[0].id===task.id){
    const alternate=lesson.tasks.findIndex(t=>t.id!==task.id);
    if(alternate>0)[lesson.tasks[0],lesson.tasks[alternate]]=[lesson.tasks[alternate],lesson.tasks[0]];
  }
  if(!lesson.tasks.length)lesson.completed=true;
  return {task,remembered,finished:lesson.completed,newlyHard:record.misses===1&&!remembered,remaining:lesson.tasks.length};
}
export function skipLesson(lesson){
  if(!lesson||lesson.tasks.length<=1)return false;
  lesson.tasks.push(lesson.tasks.shift());
  return true;
}
export function lessonDone(lesson){
  return !lesson||!lesson.tasks.length;
}
