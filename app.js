import { createCloudBridge } from './cloud-sync.js?v=20261028-13';
import { JOKES } from './jokes.js?v=20261028-11';
import { makeLesson, answerLesson, skipLesson, shuffled } from './study-engine.js?v=20261028-12';

const KEY='everyword-v1',GUEST_KEY='everyword-guest-v1',GUEST_PROMPT='everyword-guest-welcome-shown-v1',USER_PREFIX='everyword-user-v1:',LEGACY_OWNER='everyword-legacy-owner-v1',root=document.querySelector('#app'),toastEl=document.querySelector('#toast');
let state=loadGuest(),accountId=null,page='home',queue=[],lesson=null,shown=false,flipped=false,practice=false,sessionRated=0,editId=null,deleteConfirm=false,shelfEditId=null,shelfDraft=null,shelfQuery='',shelfDeleteConfirm=false,guestPrompted=localStorage.getItem(GUEST_PROMPT)==='1',done=new Set(),undo=null,modal=null,search='',fsrs=null,rating=null;
const now=()=>new Date(),id=()=>crypto.randomUUID(),norm=s=>String(s||'').trim().toLocaleLowerCase(),safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function load(){try{const x=JSON.parse(localStorage.getItem(KEY));if(Array.isArray(x?.cards))return x}catch{}return {cards:[]}}
function loadGuest(){
  try{const raw=localStorage.getItem(GUEST_KEY);if(raw){const x=JSON.parse(raw);if(Array.isArray(x.cards))return x}}catch(e){console.error(e)}
  return !localStorage.getItem(LEGACY_OWNER)?load():{cards:[]};
}
function loadAccount(uid){
  try{const raw=localStorage.getItem(USER_PREFIX+uid);if(raw){const x=JSON.parse(raw);if(Array.isArray(x.cards))return x}}catch(e){console.error(e)}
  return null;
}
function mergeCardSets(left,right){
  const merged=new Map((left?.cards||[]).filter(c=>c?.id).map(c=>[c.id,c]));
  for(const c of (right?.cards||[]))if(c?.id){
    const previous=merged.get(c.id);
    if(!previous||String(c.updatedAt||c.createdAt||'')>String(previous.updatedAt||previous.createdAt||''))merged.set(c.id,c);
  }
  const shelves=new Map((left?.shelves||[]).filter(s=>s?.id).map(s=>[s.id,s]));
  for(const shelf of right?.shelves||[]){const prev=shelves.get(shelf.id);if(!prev||String(shelf.updatedAt)>String(prev.updatedAt))shelves.set(shelf.id,shelf)}
  return {cards:[...merged.values()],practices:[...new Map([...(left?.practices||[]),...(right?.practices||[])].map(p=>[p.id,p])).values()],shelves:[...shelves.values()]};
}
function switchAccount(user){
  const uid=user?.id||null;
  if(uid===accountId)return;
  const previous=accountId;
  if(!previous){try{localStorage.setItem(GUEST_KEY,JSON.stringify(state))}catch(e){console.error(e)}}
  accountId=uid;queue=[];lesson=null;shown=false;flipped=false;practice=false;sessionRated=0;editId=null;shelfEditId=null;shelfDraft=null;undo=null;modal=null;page='home';search='';
  if(!uid){state=loadGuest();guestPrompted=localStorage.getItem(GUEST_PROMPT)==='1';render();return}
  let saved=loadAccount(uid);
  const owner=localStorage.getItem(LEGACY_OWNER);
  if(owner===uid)saved=mergeCardSets(saved,load());
  if(!previous){
    const guest=loadGuest();
    if(guest.cards.length||(guest.shelves||[]).length){
      saved=mergeCardSets(saved,guest);
      try{localStorage.setItem(GUEST_KEY,JSON.stringify({cards:[]}))}catch(e){console.error(e)}
    }
  }
  state=saved||{cards:[]};
  try{
    localStorage.setItem(USER_PREFIX+uid,JSON.stringify(state));
    if(!owner&&load().cards.length)localStorage.setItem(LEGACY_OWNER,uid);
  }catch(e){console.error('Не удалось сохранить данные аккаунта',e)}
  render();
}
function save(){
  try{localStorage.setItem(accountId?USER_PREFIX+accountId:GUEST_KEY,JSON.stringify(state));if(accountId)cloud.localChange()}
  catch{alert('Не удалось сохранить данные. Экспортируй резервную копию.')}
}
function maybeInviteAfterLesson(){
  if(accountId||cloud.signedIn||guestPrompted||!sessionRated)return;
  guestPrompted=true;
  try{localStorage.setItem(GUEST_PROMPT,'1')}catch(e){console.error(e)}
  modal='guest-invite';
}
function notify(s){toastEl.textContent=s;toastEl.style.display='block';clearTimeout(notify.timer);notify.timer=setTimeout(()=>toastEl.style.display='none',3000)}
function today(){const d=now();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function daily(c){return (c.history||[]).filter(x=>x.at.slice(0,10)===today())}
function activeCards(){return state.cards.filter(c=>!c.deletedAt)}
function completedPractices(){return Array.isArray(state.practices)?state.practices:[]}
function shelves(){return Array.isArray(state.shelves)?state.shelves:[]}
function activeShelves(){return shelves().filter(s=>!s.deletedAt)}
function streakDays(){
  const unique=new Set(completedPractices().map(p=>p.day));
  const cursor=new Date();cursor.setHours(12,0,0,0);
  if(!unique.has(today()))cursor.setDate(cursor.getDate()-1);
  let count=0;
  while(count<10000){
    const day=[cursor.getFullYear(),String(cursor.getMonth()+1).padStart(2,'0'),String(cursor.getDate()).padStart(2,'0')].join('-');
    if(!unique.has(day))break;
    count++;cursor.setDate(cursor.getDate()-1);
  }
  return count;
}
function checked(){return activeCards().filter(c=>daily(c).length).length}
function tally(){let a=0,b=0;activeCards().forEach(c=>{const x=daily(c)[0];if(x){if(x.remembered)a++;else b++}});return [a,b]}
function due(c){return c.fsrs && new Date(c.fsrs.due)<=now()}
function fresh(c){return !c.fsrs}
function archive(c){return c.fsrs&&c.fsrs.scheduled_days>=30&&new Set((c.history||[]).filter(x=>x.remembered&&!x.practice).map(x=>x.at.slice(0,10))).size>=5}
function stats(){const cards=activeCards();return {all:cards.length,new:cards.filter(fresh).length,due:cards.filter(c=>c.fsrs&&due(c)).length,hard:cards.filter(c=>c.difficult).length}}
function add(ru,en,example='',exampleRu='',note=''){
  ru=String(ru).trim();en=String(en).trim();
  if(!ru||!en)return false;
  if(activeCards().some(c=>norm(c.ru)===norm(ru)&&norm(c.en)===norm(en)))return false;
  state.cards.push({id:id(),ru,en,example,exampleRu,note,createdAt:now().toISOString(),updatedAt:now().toISOString(),fsrs:null,history:[],difficult:false});
  return true;
}
function dateOfCard(c){
 const d=new Date(c.createdAt);
 if(!Number.isFinite(d.getTime()))return '';
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function latestAddedGroup(){
 const all=activeCards();const dates=all.map(dateOfCard).filter(Boolean).sort();
 if(!dates.length)return {day:null,cards:[]};
 const day=dates[dates.length-1];
 return {day,cards:all.filter(c=>dateOfCard(c)===day)};
}
function dateLabel(day){
 if(!day)return 'Пока нет слов';
 if(day===today())return 'Добавлены сегодня';
 const [y,m,d]=day.split('-');return 'Последнее пополнение · '+d+'.'+m+'.'+y;
}
function currentTask(){return lesson&&!lesson.completed?lesson.tasks[0]:null}
function current(){const task=currentTask();return task?state.cards.find(c=>c.id===task.id&&!c.deletedAt):null}
function begin(kind='new',shelfId=null){
 const cards=activeCards();
 const selected=kind==='new'?latestAddedGroup().cards:
  kind==='due'?cards.filter(c=>c.fsrs&&due(c)):
  kind==='hard'?cards.filter(c=>c.difficult):
  kind==='shelf'?cards.filter(c=>activeShelves().find(sh=>sh.id===shelfId)?.cardIds.includes(c.id)):
  shuffled(cards).slice(0,30);
 lesson=selected.length?makeLesson(selected,kind):null;
 if(lesson){lesson.shelfId=shelfId;lesson.title=kind==='shelf'?activeShelves().find(sh=>sh.id===shelfId)?.title:null}
 practice=kind!=='new';sessionRated=0;undo=null;shown=false;flipped=false;page='study';render();
}

function sidebar(){
  const menus=[['home','⌂ Главная'],['study','◇ Учить слова'],['library','▤ Мои слова'],['add','＋ Добавить'],['shelves','▦ Полка'],['settings','⚙ Настройки']];
  return '<aside class="side"><div class="logo">everyword<small>MY ENGLISH SPACE</small></div><nav class="nav">'+
    menus.map(([p,t])=>'<button data-page="'+p+'" class="'+(page===p?'active':'')+'">'+t+'</button>').join('')+
    '<div class="nav-account"><button data-page="account" class="'+(page==='account'?'active':'')+'">◎ Аккаунт</button><span class="account-hint">'+(cloud.signedIn?'Вход выполнен':'Войти и сохранить прогресс')+'</span></div></nav></aside>';
}
function mobile(){
  return '<nav class="mobile">'+[['home','⌂ Главная'],['study','◇ Учить'],['library','▤ Слова'],['add','＋ Добавить'],['shelves','▦ Полка'],['account','◎ Аккаунт']].map(([p,t])=>
    '<button data-page="'+p+'" class="'+(page===p?'active':'')+'">'+t+'</button>').join('')+'</nav>';
}
const heading=(k,t,s)=>'<div class="eyebrow">'+k+'</div><h1>'+t+'</h1><div class="muted">'+s+'</div>';
const JOKE_ROTATION_KEY='everyword-jokes-rotation-v1';
function drawJoke(){
  if(!JOKES.length)return 'Сегодня анекдоты сбежали. Видимо, у них выходной.';
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(JOKE_ROTATION_KEY)||'{}')||{}}catch{}
  let left=Array.isArray(saved.left)&&saved.size===JOKES.length&&
    saved.left.every(n=>Number.isInteger(n)&&n>=0&&n<JOKES.length)&&
    new Set(saved.left).size===saved.left.length?saved.left.slice():[];
  if(!left.length){
    left=JOKES.map((_,i)=>i);
    for(let i=left.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [left[i],left[j]]=[left[j],left[i]];
    }
    // Avoid showing the last joke again when a new cycle starts.
    if(left.length>1&&left[left.length-1]===saved.last){
      [left[left.length-1],left[0]]=[left[0],left[left.length-1]];
    }
  }
  const index=left.pop();
  try{localStorage.setItem(JOKE_ROTATION_KEY,JSON.stringify({size:JOKES.length,left,last:index}))}catch{}
  return JOKES[index];
}
let jokeOfVisit=drawJoke();
function jokeMarkup(){return safe(jokeOfVisit).replaceAll(' — ',String.fromCharCode(10)+'— ')}
const PRACTICE_EXPLANATIONS={
 new:'Слова, добавленные сегодня. Если сегодня новых нет — слова из последнего пополнения. Каждое слово проверяется в двух направлениях. Результаты учитываются в расписании повторений.',
 due:'Слова, которые пора повторить по индивидуальному расписанию. Алгоритм учитывает, насколько хорошо ты их помнишь, и определяет дату следующего повторения.',
 free:'30 случайных слов из всей коллекции. После завершения можно начать новую практику с другой случайной выборкой. Все результаты учитываются в расписании повторений.',
 hard:'Слова, которые ты не смогла вспомнить минимум дважды за одно занятие. Здесь можно отдельно потренировать их и улучшить запоминание. Результаты также учитываются в общем расписании.',
 shelf:'Занятие только со словами из выбранной тематической полки. Результаты влияют на общее расписание повторений, как и в других практиках.'
};
function modeInfo(kind){
 const desc=PRACTICE_EXPLANATIONS[kind]||'';
 return '<details class="mode-info"><summary aria-label="Информация о практике" title="О практике"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></summary><div class="mode-info-text" role="note">'+safe(desc)+'</div></details>';
}
const PRAISES=[
 'Отличная работа!','Хорошо справилась!','Ты молодец — занятие завершено.',
 'Здорово поработала.','Вот это настойчивость!','Очень достойно!',
 'Хороший результат!','Так держать!','Получилось отлично.',
 'Супер, ещё одно занятие позади.','Классно справилась!','Прекрасно поработала.',
 'Ты отлично потрудилась.','Ещё одна практика завершена — молодец!',
 'Хорошая работа сегодня.','Умница, довела занятие до конца.'
];
function nextPraise(){
 const last=Number(localStorage.getItem('everyword-last-praise-v1'));
 const options=PRAISES.map((_,i)=>i).filter(i=>i!==last);
 const choice=options[Math.floor(Math.random()*options.length)];
 try{localStorage.setItem('everyword-last-praise-v1',String(choice))}catch{}
 return PRAISES[choice];
}
function home(){
 const s=stats(),streak=streakDays(),group=latestAddedGroup();
 return '<div class="streak-strip"><span class="streak-flame" aria-hidden="true">✦</span><div><strong>'+streak+' '+(streak===1?'день':streak%10>=2&&streak%10<=4&&(streak%100<12||streak%100>14)?'дня':'дней')+' подряд</strong><span>без пропусков занятий</span></div></div>'+
 '<section class="home-heading"><div class="eyebrow">Личное пространство</div><h1 class="home-title"><span class="home-title-lead">Английский,</span><span class="home-title-tail">в своём ритме</span></h1><p class="muted home-subtitle">Все слова в одном месте. Возвращайся к ним на пути к европейскому паспорту.</p><span class="home-sun" aria-hidden="true"></span></section>'+
 '<div class="stats"><div class="stat"><span>В коллекции</span><b>'+s.all+'</b><span>слов и выражений</span></div><div class="stat"><span>Последнее пополнение</span><b>'+group.cards.length+'</b><span>для нового занятия</span></div><div class="stat"><span>Сложные слова</span><b>'+s.hard+'</b><span>для повторения</span></div></div>'+
 '<section class="new-words-hero practice-with-info">'+modeInfo('new')+'<div class="eyebrow">НОВОЕ ЗАНЯТИЕ</div><h2>Новые слова</h2><div class="new-group-note">'+dateLabel(group.day)+' · '+group.cards.length+' '+(group.cards.length===1?'слово':'слов')+'</div><button class="primary" data-action="begin" '+(!group.cards.length?'disabled':'')+'>Начать занятие →</button></section>'+
 '<section class="due-words-hero practice-with-info">'+modeInfo('due')+'<div><div class="eyebrow">ПО РАСПИСАНИЮ FSRS</div><h2>Повторить сегодня</h2><p class="muted">'+(s.due?s.due+' '+(s.due===1?'слово':s.due%10>=2&&s.due%10<=4&&(s.due%100<12||s.due%100>14)?'слова':'слов')+' к повторению':'Все запланированные повторения выполнены')+'</p></div><button class="secondary" data-action="due" '+(!s.due?'disabled':'')+'>Повторить →</button></section>'+
 '<div class="practice-mode-grid"><section class="practice-mode-card practice-with-info">'+modeInfo('free')+'<div class="eyebrow">БЕЗ ОГРАНИЧЕНИЙ</div><h2>Свободная практика</h2><p>30 случайных слов из коллекции. Каждая практика заканчивается.</p><button class="secondary" data-action="practice" '+(!s.all?'disabled':'')+'>Практиковаться →</button></section><section class="practice-mode-card practice-hard practice-with-info">'+modeInfo('hard')+'<div class="eyebrow">ТОЧКА РОСТА</div><h2>Сложные слова</h2><p>Слова, которые потребовали дополнительных попыток. Сейчас: '+s.hard+'.</p><button class="secondary" data-action="hard" '+(!s.hard?'disabled':'')+'>Повторить сложные →</button></section></div>'+
 '<section class="add-words-strip"><div><div class="eyebrow">ПОПОЛНИ КОЛЛЕКЦИЮ</div><h2>Появились новые слова?</h2><p class="muted">Сохрани их и возвращайся к ним в следующих занятиях.</p></div><button class="secondary" data-page="add">＋ Добавить слова</button></section>'+
 '<footer class="joke-footer"><span class="joke-label">АНЕКДОТ</span><p class="joke-body">'+jokeMarkup()+'</p><button class="joke-next" type="button" data-action="next-joke" aria-label="Показать другой анекдот">Другой анекдот ↻</button></footer>';
}
function speakerButton(){
 return '<button type="button" class="speak-button" data-action="speak" aria-label="Произнести по-английски" title="Прослушать произношение"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>';
}
function study(){
 const c=current(),task=currentTask(),label=lesson?.kind==='hard'?'Сложные слова':lesson?.kind==='free'?'Свободная практика':lesson?.kind==='shelf'?(lesson.title||'Полка'):'Новые слова';
 if(!c||!task){
   return heading('МОЁ ЗАНЯТИЕ',label,lesson?.completed?'Практика завершена. Результат сохранён.':'В этом режиме пока нет слов.')+
   '<div class="panel study-finished"><h2>'+(lesson?.completed?'Занятие завершено':'На сейчас всё!')+'</h2><p class="muted">'+(lesson?.completed?'В обоих направлениях все карточки успешно пройдены.':'Ты можешь добавить новые слова или выбрать свободную практику.')+'</p><div class="stack"><button class="primary" data-page="home">На главную</button><button class="secondary" data-action="practice">Свободная практика</button><button class="secondary" data-action="hard" '+(!stats().hard?'disabled':'')+'>Сложные слова</button></div></div>';
 }
 const frontEnglish=task.side==='en', englishVisible=frontEnglish!==flipped;
 const headingText=frontEnglish?(flipped?'РУССКИЙ · ОТВЕТ':'ENGLISH · ПЕРЕВЕДИ НА РУССКИЙ'):(flipped?'ENGLISH · ОТВЕТ':'РУССКИЙ · ПЕРЕВЕДИ НА АНГЛИЙСКИЙ');
 const record=lesson.records[c.id][task.side],need=record.required===3?' · успешно '+record.correct+'/3':'';
 return heading('МОЁ ЗАНЯТИЕ',label,'Переведи мысленно, открой ответ, затем оцени. Ошибки возвращаются в случайном порядке.')+
 '<div class="study"><div class="row"><span class="pill">'+(frontEnglish?'EN → RU':'RU → EN')+need+'</span><span class="muted">Осталось предъявлений: '+lesson.tasks.length+'</span></div>'+
 '<div class="card '+(flipped?'revealed':'')+'" role="button" tabindex="0" data-action="flip"><div class="eyebrow">'+headingText+'</div>'+
 '<div class="word-with-sound"><div class="word">'+safe(englishVisible?c.en:c.ru)+'</div>'+(englishVisible?speakerButton():'')+'</div>'+
 (flipped?'<div class="example">'+safe(c.example||'')+'</div><div class="muted">'+safe(c.exampleRu||'')+'</div><div class="muted">'+safe(c.note||'')+'</div>':'')+
 '<small>↻ Нажимай, чтобы переворачивать</small></div>'+
 '<div class="actions"><button class="no" data-action="no" '+(!shown?'disabled':'')+'>✕ Не вспомнила</button><button class="yes" data-action="yes" '+(!shown?'disabled':'')+'>✓ Вспомнила</button></div>'+
 '<div class="row"><button class="link" data-action="skip">↔ Пропустить</button>'+(undo?'<button class="link" data-action="undo">↶ Отменить оценку</button>':'')+'</div>'+
 (!fsrs&&lesson.kind==='new'?'<div class="alert">Подключаем FSRS… Для сохранения оценок нужен интернет.</div>':'')+
 '</div>';
}
function library(){
 return heading('МОЯ КОЛЛЕКЦИЯ','Все слова','Открой любую карточку, чтобы изменить перевод, примеры, пояснение или удалить её.')+
 '<div class="stack"><input class="search" id="search" placeholder="Поиск по словам…" value="'+safe(search)+'" aria-label="Поиск"></div>'+
 '<div id="results">'+results()+'</div>';
}
function results(){
 const cards=activeCards().filter(c=>norm(c.ru+' '+c.en+' '+c.example).includes(norm(search)));
 return '<div class="grid">'+cards.slice().reverse().map(c=>{
  const h=daily(c),status=h.length?h[h.length-1].remembered:null;
  return '<div class="wordrow"><div class="row"><strong>'+safe(c.en)+'</strong><span class="dot '+(status===true?'yes':status===false?'no':'')+'"></span></div><p class="ru">'+safe(c.ru)+'</p><div class="row"><small class="muted">'+(c.difficult?'Сложное слово':archive(c)?'Архив':fresh(c)?'Новое':due(c)?'Пора повторить':'Повторение позже')+'</small><button class="link" data-action="edit" data-id="'+safe(c.id)+'">Редактировать</button></div></div>';
 }).join('')+'</div>'+(cards.length?'':'<p class="muted">Пока ничего не найдено.</p>');
}
function shelfPage(){
 const collection=activeShelves().slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
 return heading('ТЕМАТИЧЕСКИЕ ПОДБОРКИ','Полка','Собирай слова по темам: для работы, путешествий или любых других задач. Одно слово может лежать на нескольких полках.')+
 '<div class="shelf-toolbar"><span class="muted">'+collection.length+' '+(collection.length===1?'полка':'полок')+'</span><button class="primary" data-action="shelf-new">＋ Новая полка</button></div>'+
 (collection.length?'<div class="shelf-grid">'+collection.map(sh=>{
   const included=activeCards().filter(c=>sh.cardIds.includes(c.id));
   return '<section class="shelf-card"><div class="shelf-card-icon" aria-hidden="true">▦</div><h2>'+safe(sh.title)+'</h2>'+
    (sh.description?'<p class="shelf-description">'+safe(sh.description)+'</p>':'')+
    '<p class="muted">'+included.length+' '+(included.length===1?'слово':included.length>=2&&included.length<=4?'слова':'слов')+'</p>'+
    (included.length?'<div class="shelf-preview">'+included.slice(0,5).map(c=>'<span>'+safe(c.en)+'</span>').join('')+(included.length>5?'<span>+ '+(included.length-5)+'</span>':'')+'</div>':'<p class="shelf-empty">Пока пусто — добавь слова из коллекции</p>')+
    '<div class="shelf-actions"><button class="primary" data-action="shelf-start" data-id="'+safe(sh.id)+'" '+(!included.length?'disabled':'')+'>Учить слова →</button><button class="secondary" data-action="shelf-edit" data-id="'+safe(sh.id)+'">Изменить</button></div></section>'
 }).join('')+'</div>':'<div class="shelf-welcome"><div class="shelf-welcome-icon" aria-hidden="true">▦</div><h2>Твои слова — по полочкам</h2><p>Например, «Для работы», «В путешествии» или «Полезные выражения». Создай первую полку и выбери слова из коллекции.</p><button class="primary" data-action="shelf-new">Создать полку →</button></div>')+
 '<div class="shelf-hint">В дальнейшем можно попросить ChatGPT собрать тематическую полку из слов, которые уже есть в твоей коллекции.</div>';
}
function openShelfEditor(sh=null){
 shelfEditId=sh?.id||'new';
 shelfDraft={title:sh?.title||'',description:sh?.description||'',selected:new Set(sh?.cardIds||[])};
 shelfQuery='';shelfDeleteConfirm=false;render();
}
function shelfChoices(){
 if(!shelfDraft)return '';
 const cards=activeCards().filter(c=>norm(c.en+' '+c.ru+' '+c.example).includes(norm(shelfQuery)));
 return cards.length?cards.map(c=>'<label class="shelf-word-choice"><input type="checkbox" data-shelf-card="'+safe(c.id)+'" '+(shelfDraft.selected.has(c.id)?'checked':'')+'><span><strong>'+safe(c.en)+'</strong><small>'+safe(c.ru)+'</small></span></label>').join(''):
 '<p class="muted">По этому запросу слов не найдено.</p>';
}
function shelfEditor(){
 if(!shelfDraft)return '';
 const old=shelfEditId!=='new'?activeShelves().find(sh=>sh.id===shelfEditId):null;
 return '<div class="overlay"><section class="popup edit-popup shelf-edit-popup" role="dialog" aria-modal="true" aria-label="Настроить полку">'+
 '<div class="row"><h2>'+(old?'Изменить полку':'Создать полку')+'</h2><button class="edit-close" data-action="shelf-close" aria-label="Закрыть">×</button></div>'+
 '<form id="shelf-editor"><div class="field"><label>Название полки *</label><input name="title" required maxlength="80" placeholder="Например, Для работы" value="'+safe(shelfDraft.title)+'"></div>'+
 '<div class="field"><label>Описание (необязательно)</label><textarea name="description" maxlength="300" placeholder="Для чего эта подборка">'+safe(shelfDraft.description)+'</textarea></div>'+
 '<div class="shelf-picker-title"><strong>Слова из твоей коллекции</strong><span id="shelf-selected-count">'+shelfDraft.selected.size+' выбрано</span></div>'+
 '<input class="search" id="shelf-search" placeholder="Найти по-русски или по-английски…" value="'+safe(shelfQuery)+'" aria-label="Найти слово для полки">'+
 '<div id="shelf-choices" class="shelf-choices">'+shelfChoices()+'</div>'+
 '<div class="edit-actions"><button class="primary" type="submit">Сохранить полку</button><button class="secondary" type="button" data-action="shelf-close">Отмена</button></div></form>'+
 (old?(shelfDeleteConfirm?'<div class="delete-confirm"><p>Удалить полку? Сами карточки останутся в общей коллекции.</p><button class="delete-button" data-action="shelf-delete">Да, удалить полку</button><button class="link" data-action="shelf-cancel-delete">Оставить</button></div>':'<button class="delete-link" data-action="shelf-ask-delete">Удалить полку</button>'):'')+
 '</section></div>';
}
function addPage(){return heading('НОВЫЕ СЛОВА','Пополнить коллекцию','Добавляй одну карточку или целые списки. В ближайшие занятия попадут все новые слова.')+'<section class="panel" style="margin-top:28px"><form id="single"><div class="grid"><div class="field"><label>Русский смысл *</label><input name="ru" required placeholder="Разобраться"></div><div class="field"><label>Английское выражение *</label><input name="en" required placeholder="figure out"></div><div class="field"><label>Пример на английском</label><input name="example" placeholder="I will figure it out."></div><div class="field"><label>Перевод примера</label><input name="exampleRu"></div></div><div class="field"><label>Пояснение / контекст</label><textarea name="note"></textarea></div><button class="primary">＋ Сохранить карточку</button></form></section><section class="panel" style="margin-top:20px"><h2>Добавить списком</h2><p class="muted">Одна карточка в строке, поля разделяются вертикальной чертой |. Порядок: русский смысл | английское слово | пример EN | перевод примера | пояснение.</p><form id="bulk"><div class="field"><textarea name="bulk" required placeholder="Разобраться | figure out | I will figure it out.&#10;Тем не менее | nevertheless"></textarea></div><button class="secondary">＋ Добавить весь список</button></form></section>'}
function account(){
  if(cloud.signedIn){
    return heading('ЛИЧНЫЙ КАБИНЕТ','Мой аккаунт','Твои слова и прогресс доступны на всех устройствах, где выполнен вход.')+
      '<section class="panel account-panel"><div class="eyebrow">ТВОЙ EVERYWORD</div><h2>'+safe(cloud.email)+'</h2><p class="muted">Синхронизация: '+safe(cloudStatusText())+'</p><div class="stack"><button class="primary" data-action="cloud-refresh">↻ Синхронизировать сейчас</button><button class="secondary" data-action="cloud-signout">Выйти из аккаунта</button></div></section>';
  }
  return heading('ТВОЙ АККАУНТ','Сохрани свои слова','Можно добавлять карточки и заниматься без регистрации. Вход нужен, чтобы продолжать с любого устройства.')+
    '<section class="panel account-panel"><div class="eyebrow">СОХРАНЯЙ СВОЙ ПРОГРЕСС</div><h2>Все твои слова — всегда с тобой</h2><p class="muted">Сейчас '+state.cards.length+' карточек в этом браузере. После входа они будут перенесены в твою личную коллекцию.</p><form id="cloud-login" class="account-login"><div class="field"><label>Твоя электронная почта</label><input type="email" name="email" required autocomplete="email" placeholder="name@example.com"></div><button class="primary" type="submit">Войти / создать аккаунт →</button></form>'+
    (cloud.status==='email-sent'?'<div class="account-message">Ссылка отправлена! Открой письмо и перейди по ней, чтобы вернуться к своим словам.</div>':'')+
    (cloud.status==='error'?'<div class="account-message">Не удалось подключиться к облаку. Пробные карточки останутся в этом браузере.</div>':'')+
    '<p class="muted account-small">Пароль не нужен. После первого входа сайт запомнит тебя на этом устройстве.</p></section>';
}
function settings(){
  return heading('НАСТРОЙКИ','Настройки и данные',cloud.signedIn?'Ты вошла в аккаунт. Карточки синхронизируются с облаком.':'Пока данные сохраняются только в этом браузере. Для синхронизации нужен аккаунт.')+
    '<div class="panel"><h2>Резервные копии</h2><p class="muted">Экспорт сохраняет карточки, историю и интервалы FSRS в JSON. Импорт объединяет карточки по идентификатору.</p><div class="stack"><button class="primary" data-action="export">↓ Скачать копию</button><label class="secondary">↑ Импортировать<input type="file" id="import" accept=".json" hidden></label></div><p class="muted">Метод повторения: FSRS · целевое удержание 90% · '+(fsrs?'подключён':'ожидает подключения')+'</p></div>'+
    '<div class="panel" style="margin-top:18px"><h2>Личный аккаунт</h2><p class="muted">'+(cloud.signedIn?'Посмотреть статус облачной синхронизации или выйти из аккаунта.':'Войди, чтобы сохранить свою коллекцию и возвращаться к ней с телефона и компьютера.')+'</p><button class="secondary" data-page="account">◎ Перейти к аккаунту</button></div>';
}
function cloudStatusText(){return ({connected:'Все изменения сохранены в облаке',syncing:'Синхронизация…',error:'Ошибка синхронизации: проверь соединение',connecting:'Подключение…','email-sent':'Проверь почту — отправлена ссылка для входа','signed-out':'Нужен вход в аккаунт',unconfigured:'Ожидаем подключения облака'})[cloud.status]||cloud.status}

const cloud=createCloudBridge({
  getCards:()=>state.cards,
  getPractices:()=>completedPractices(),
  getShelves:()=>shelves(),
  mergeShelves:incoming=>{state.shelves=incoming;save();render()},
  mergePractices:practices=>{state.practices=practices;save();render()},
  mergeCards:cards=>{state.cards=cards;try{if(accountId)localStorage.setItem(USER_PREFIX+accountId,JSON.stringify(state))}catch(e){console.error(e)}render()},
  onIdentity:switchAccount,
  onStatus:()=>{if(page==='account'||page==='settings')render()}
});
function render(){
 const content=({home,study,library,add:addPage,shelves:shelfPage,settings,account}[page]||home)();
 let popup='';
 if(editId)popup=cardEditor();
 else if(shelfDraft)popup=shelfEditor();
 else if(modal==='guest-invite')popup='<div class="overlay"><div class="popup popup-invite"><div class="eyebrow">ПЕРВОЕ ЗАНЯТИЕ</div><h2>Хочешь сохранить результат?</h2><p class="muted">Твои карточки уже здесь. Войди, чтобы продолжить обучение и с других устройств.</p><div class="invite-actions"><button class="primary" data-action="invite-login">Сохранить прогресс →</button><button class="secondary" data-action="invite-later">Пока без аккаунта</button></div></div></div>';
 else if(modal==='congratulations')popup='<div class="overlay"><div class="popup"><div class="eyebrow">ТВОЙ ПРОГРЕСС</div><b>'+completedPractices().length+' практики!</b><h2>Так держать!</h2><p class="muted">Ты завершила ещё три занятия. Продолжай в своём ритме!</p><button class="primary" data-action="close">Продолжить →</button></div></div>';
 root.innerHTML='<div class="app">'+sidebar()+'<main class="main">'+content+'</main>'+mobile()+'</div>'+popup;
}
function speakEnglish(text){
  if(!text||!text.trim())return;
  if(typeof window.speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined'){
    notify('В этом браузере озвучка недоступна. Попробуй Chrome или Safari.');return;
  }
  try{
    const speech=window.speechSynthesis;
    speech.cancel();
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang='en-US';
    utterance.rate=0.92;
    const voices=speech.getVoices();
    const voice=voices.find(v=>v.lang?.toLowerCase().replace('_','-')==='en-us')
      ||voices.find(v=>v.lang?.toLowerCase().startsWith('en'));
    if(voice)utterance.voice=voice;
    utterance.onerror=e=>{if(!['interrupted','canceled'].includes(e.error))notify('Не получилось воспроизвести произношение. Проверь звук на устройстве.')};
    speech.speak(utterance);
  }catch(e){console.error('Everyword pronunciation failed',e);notify('Не удалось озвучить слово.')}
}
function flip(){if(!currentTask())return;flipped=!flipped;if(flipped)shown=true;render()}
function skip(){if(skipLesson(lesson)){flipped=false;shown=false;undo=null;render()}else notify('Это единственная оставшаяся карточка')}
function scheduleFSRS(c,remembered){
 if(!fsrs)return;
 try{
  const input=c.fsrs?{...c.fsrs,due:new Date(c.fsrs.due),last_review:c.fsrs.last_review?new Date(c.fsrs.last_review):undefined}:window.fsrsLib.createEmptyCard(new Date(c.createdAt));
  const result=fsrs.next(input,now(),remembered?rating.Good:rating.Again);
  c.fsrs={...result.card,due:result.card.due.toISOString(),last_review:result.card.last_review?.toISOString()||null};
 }catch(e){console.error('FSRS error',e);notify('Не удалось пересчитать интервалы повторения')}
}
function finishLesson(){
 if(!lesson||!lesson.completed)return;
 if(lesson.kind==='new'){
   for(const id of lesson.cardIds){
     const c=state.cards.find(x=>x.id===id&&!x.deletedAt);
     const record=lesson.records[id];
     if(c&&record)scheduleFSRS(c,record.ru.first===true&&record.en.first===true);
     if(c)c.updatedAt=now().toISOString();
   }
 }
 if(!Array.isArray(state.practices))state.practices=[];
 state.practices.push({id:id(),day:today(),kind:lesson.kind==='new'?'scheduled':lesson.kind==='shelf'?'free':lesson.kind,at:now().toISOString()});
 save();
 const count=completedPractices().length;
 if(count%3===0)modal='congratulations';
 else maybeInviteAfterLesson();
}
function grade(remembered){
 if(!shown||!currentTask()||!lesson)return;
 if(lesson.kind==='new'&&!fsrs){notify('FSRS пока не загрузился. Проверь интернет.');return}
 const c=current();if(!c)return;
 undo={card:structuredClone(c),lesson:structuredClone(lesson)};
 const result=answerLesson(lesson,remembered);
 if(!result)return;
 c.history.push({at:now().toISOString(),remembered,practice:lesson.kind!=='new',direction:result.task.side,lessonKind:lesson.kind});
 if(result.newlyHard)c.difficult=true;
 c.updatedAt=now().toISOString();
 sessionRated++;
 shown=false;flipped=false;
 if(result.finished){undo=null;finishLesson();}
 else save();
 render();
}
function doUndo(){
 if(!undo||!lesson||lesson.completed)return;
 const i=state.cards.findIndex(c=>c.id===undo.card.id);
 if(i>=0)state.cards[i]=undo.card;
 lesson=undo.lesson;shown=true;flipped=true;undo=null;modal=null;
 save();render();
}
function cardEditor(){
 const c=state.cards.find(x=>x.id===editId&&!x.deletedAt);
 if(!c)return '';
 return '<div class="overlay" role="presentation"><section class="popup edit-popup" role="dialog" aria-modal="true" aria-label="Редактировать карточку"><div class="row"><h2>Редактировать карточку</h2><button class="edit-close" type="button" data-action="edit-close" aria-label="Закрыть">×</button></div>'+
 '<form id="card-editor"><div class="field"><label>Русский смысл *</label><textarea name="ru" required>'+safe(c.ru)+'</textarea></div>'+
 '<div class="field"><label>Английский перевод *</label><input name="en" required value="'+safe(c.en)+'"></div>'+
 '<div class="field"><label>Пример на английском</label><textarea name="example">'+safe(c.example||'')+'</textarea></div>'+
 '<div class="field"><label>Перевод примера</label><textarea name="exampleRu">'+safe(c.exampleRu||'')+'</textarea></div>'+
 '<div class="field"><label>Пояснение / контекст</label><textarea name="note">'+safe(c.note||'')+'</textarea></div>'+
 '<label class="edit-difficult"><input type="checkbox" name="difficult" '+(c.difficult?'checked':'')+'> Считать сложным словом</label>'+
 '<div class="edit-actions"><button class="primary" type="submit">Сохранить изменения</button><button class="secondary" type="button" data-action="edit-close">Отмена</button></div></form>'+
 (deleteConfirm?'<div class="delete-confirm"><p>Удалить слово из коллекции? Оно больше не появится в занятиях на твоих устройствах.</p><button class="delete-button" type="button" data-action="delete-card">Да, удалить карточку</button><button class="link" type="button" data-action="cancel-delete">Оставить</button></div>':'<button class="delete-link" type="button" data-action="ask-delete">Удалить карточку</button>')+
 '</section></div>';
}
async function importData(file){if(!file)return;try{const x=JSON.parse(await file.text());if(!Array.isArray(x.cards))throw Error('Wrong format');const ids=new Set(state.cards.map(c=>c.id));let n=0;for(const c of x.cards){if(c.id&&c.ru&&c.en&&Array.isArray(c.history)&&!ids.has(c.id)){state.cards.push(c);ids.add(c.id);n++}}save();render();notify('Импортировано карточек: '+n)}catch{notify('Не удалось импортировать файл')}}
const examples=[['Разобраться, выяснить','figure out','I need to figure out what happened.','Мне нужно разобраться, что произошло.'],['Тем не менее','nevertheless','Nevertheless, I decided to go.','Тем не менее я решила пойти.'],['В итоге, со временем','eventually','Eventually, everything worked out.','В итоге всё получилось.'],['Случайно встретить','run into','I ran into an old friend.','Я случайно встретила старого друга.'],['Ладить с кем-то','get along with','I get along with my team.','Я хорошо лажу со своей командой.'],['Принимать как должное','take for granted',"Don't take it for granted.",'Не воспринимай это как должное.']];
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-page],[data-action]');
 if(!b)return;
 if(b.dataset.page){
   const dest=b.dataset.page;
   if(dest==='study'){
     if(!lesson||lesson.completed)begin('new');
     else {page='study';render()}
   }else{page=dest;render()}
   return;
 }
 const a=b.dataset.action;
 if(a==='begin')begin('new');
 else if(a==='practice')begin('free');
 else if(a==='hard')begin('hard');
 else if(a==='shelf-start'){const sh=activeShelves().find(x=>x.id===b.dataset.id);if(sh)begin('shelf',sh.id)}
 else if(a==='shelf-new')openShelfEditor();
 else if(a==='shelf-edit'){const sh=activeShelves().find(x=>x.id===b.dataset.id);if(sh)openShelfEditor(sh)}
 else if(a==='shelf-close'){shelfEditId=null;shelfDraft=null;shelfDeleteConfirm=false;render()}
 else if(a==='shelf-ask-delete'){shelfDeleteConfirm=true;render()}
 else if(a==='shelf-cancel-delete'){shelfDeleteConfirm=false;render()}
 else if(a==='shelf-delete'){const sh=activeShelves().find(x=>x.id===shelfEditId);if(sh){sh.deletedAt=now().toISOString();sh.updatedAt=sh.deletedAt;save()}shelfEditId=null;shelfDraft=null;shelfDeleteConfirm=false;render();notify('Полка удалена. Слова остались в коллекции')}
 else if(a==='next-joke'){jokeOfVisit=drawJoke();render()}
 else if(a==='samples'){examples.forEach(x=>add(...x));save();render();notify('Добавлено 6 примеров')}
 else if(a==='flip')flip();
 else if(a==='speak'){e.stopPropagation();speakEnglish(current()?.en||'')}
 else if(a==='skip')skip();
 else if(a==='yes')grade(true);
 else if(a==='no')grade(false);
 else if(a==='undo')doUndo();
 else if(a==='cloud-refresh')cloud.refresh().then(()=>notify('Облако проверено')).catch(()=>notify('Ошибка обновления'));
 else if(a==='cloud-signout')cloud.signOut().then(()=>{render();notify('Выход выполнен')}).catch(()=>notify('Не удалось выйти из аккаунта'));
 else if(a==='invite-login'){modal=null;page='account';render()}
 else if(a==='invite-later'){modal=null;render()}
 else if(a==='close'){modal=null;render()}
 else if(a==='edit'){
   const c=activeCards().find(x=>x.id===b.dataset.id);
   if(c){editId=c.id;deleteConfirm=false;render()}
 }else if(a==='edit-close'){editId=null;deleteConfirm=false;render()}
 else if(a==='ask-delete'){deleteConfirm=true;render()}
 else if(a==='cancel-delete'){deleteConfirm=false;render()}
 else if(a==='delete-card'){
   const c=activeCards().find(x=>x.id===editId);
   if(!c)return;
   c.deletedAt=now().toISOString();c.updatedAt=c.deletedAt;
   if(lesson&&!lesson.completed){
     lesson.tasks=lesson.tasks.filter(t=>t.id!==c.id);
     lesson.cardIds=lesson.cardIds.filter(x=>x!==c.id);
     // Deleting the last card cancels an unfinished lesson, not a completion.
     if(!lesson.tasks.length)lesson=null;
   }
   editId=null;deleteConfirm=false;undo=null;
   save();page='library';render();notify('Карточка удалена');
 }else if(a==='export'){
   const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
   const u=URL.createObjectURL(blob);const link=document.createElement('a');link.href=u;link.download='everyword-backup-'+today()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(u),500);
 }
});
document.addEventListener('submit',e=>{
 if(e.target.id==='cloud-login'){
   e.preventDefault();const email=String(new FormData(e.target).get('email')||'').trim();
   cloud.signIn(email).then(()=>{render();notify('Ссылка отправлена на почту')}).catch(err=>notify(err?.message||'Не удалось отправить письмо'));
   return;
 }
 if(e.target.id==='card-editor'){
   e.preventDefault();
   const c=activeCards().find(x=>x.id===editId);
   if(!c)return;
   const form=new FormData(e.target);
   const ru=String(form.get('ru')||'').trim(),en=String(form.get('en')||'').trim();
   if(!ru||!en){notify('Русское и английское поля обязательны');return}
   const duplicate=activeCards().some(x=>x.id!==c.id&&norm(x.ru)===norm(ru)&&norm(x.en)===norm(en));
   if(duplicate){notify('Такая карточка уже есть в коллекции');return}
   c.ru=ru;c.en=en;
   c.example=String(form.get('example')||'').trim();
   c.exampleRu=String(form.get('exampleRu')||'').trim();
   c.note=String(form.get('note')||'').trim();
   c.difficult=form.has('difficult');
   c.updatedAt=now().toISOString();
   save();editId=null;deleteConfirm=false;render();notify('Карточка обновлена');
   return;
 }
 if(e.target.id==='shelf-editor'){
   e.preventDefault();
   if(!shelfDraft)return;
   const data=new FormData(e.target);
   const title=String(data.get('title')||'').trim(),description=String(data.get('description')||'').trim();
   if(!title){notify('Укажи название полки');return}
   const existing=activeShelves().find(x=>x.id===shelfEditId);
   const cardIds=[...shelfDraft.selected].filter(x=>activeCards().some(c=>c.id===x));
   if(existing){Object.assign(existing,{title,description,cardIds,updatedAt:now().toISOString()})}
   else{
     if(!Array.isArray(state.shelves))state.shelves=[];
     const moment=now().toISOString();
     state.shelves.push({id:id(),title,description,cardIds,createdAt:moment,updatedAt:moment});
   }
   shelfEditId=null;shelfDraft=null;shelfQuery='';shelfDeleteConfirm=false;
   save();page='shelves';render();notify('Полка сохранена');return;
 }
 if(!['single','bulk'].includes(e.target.id))return;
 e.preventDefault();
 const f=new FormData(e.target);
 let n=0;
 if(e.target.id==='single')n=Number(add(...['ru','en','example','exampleRu','note'].map(k=>String(f.get(k)||''))));
 else for(const line of String(f.get('bulk')||'').split(/\r?\n/)){const p=line.split('|').map(x=>x.trim());if(p.length>=2)n+=Number(add(...p.slice(0,5)))}
 save();e.target.reset();render();notify('Добавлено карточек: '+n);
});
document.addEventListener('input',e=>{
 if(e.target.id==='search'){search=e.target.value;document.querySelector('#results').innerHTML=results()}
 else if(e.target.id==='shelf-search'&&shelfDraft){shelfQuery=e.target.value;document.querySelector('#shelf-choices').innerHTML=shelfChoices()}
});
document.addEventListener('change',e=>{
 if(e.target.id==='import')importData(e.target.files?.[0]);
 else if(e.target.matches('[data-shelf-card]')&&shelfDraft){
   const cardId=e.target.dataset.shelfCard;
   if(e.target.checked)shelfDraft.selected.add(cardId);else shelfDraft.selected.delete(cardId);
   const label=document.querySelector('#shelf-selected-count');
   if(label)label.textContent=shelfDraft.selected.size+' выбрано';
 }
});
document.addEventListener('keydown',e=>{if(page!=='study'||e.target.matches('input,textarea,button,select,a')||modal)return;if(e.key===' '||e.key==='Enter'){e.preventDefault();flip()}else if(['ArrowLeft','ArrowRight'].includes(e.key))skip();else if(e.key==='1')grade(false);else if(e.key==='2')grade(true)});
let startX=null;document.addEventListener('touchstart',e=>{if(e.target.closest('.card')&&!e.target.closest('.speak-button'))startX=e.touches[0].clientX},{passive:true});document.addEventListener('touchend',e=>{if(startX===null)return;const dx=e.changedTouches[0].clientX-startX;startX=null;if(Math.abs(dx)>65){e.preventDefault();skip()}},{passive:false});
render();
async function initialize(){for(const url of ['https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.2/dist/index.mjs','https://unpkg.com/ts-fsrs@5.4.2/dist/index.mjs','https://esm.sh/ts-fsrs@5.4.2?bundle'])try{const lib=await import(url);if(!lib.fsrs||!lib.createEmptyCard)continue;window.fsrsLib=lib;rating=lib.Rating;fsrs=lib.fsrs({request_retention:0.9,enable_short_term:true,learning_steps:['1m','10m'],relearning_steps:['10m'],enable_fuzz:true});render();return}catch(e){console.warn('FSRS source unavailable',e)}notify('Не удалось загрузить FSRS. Проверь интернет.');render()}
initialize();cloud.init();
