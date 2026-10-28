// Everyword lesson engine: both translation directions, randomized presentation,
// with three successful follow-up recalls after a mistake on either direction.
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
  const tasks=shuffled(cards.flatMap(c=>[{id:c.id,side:'ru'},{id:c.id,side:'en'}]),random);
  return {kind,records,tasks,answerCount:0,cardIds:cards.map(c=>c.id),completed:false};
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
    side.required=3;
  }
  const pending=side.correct<side.required;
  if(pending){
    // Other cards/directions are encountered first when available.
    const minIndex=Math.min(2,lesson.tasks.length);
    const index=minIndex+Math.floor(random()*(lesson.tasks.length-minIndex+1));
    lesson.tasks.splice(index,0,task);
  }
  if(!lesson.tasks.length)lesson.completed=true;
  return {task,remembered,finished:lesson.completed,newlyHard:record.misses===2&&!remembered,remaining:lesson.tasks.length};
}
export function skipLesson(lesson){
  if(!lesson||lesson.tasks.length<=1)return false;
  lesson.tasks.push(lesson.tasks.shift());
  return true;
}
export function lessonDone(lesson){
  return !lesson||!lesson.tasks.length;
}
