import { createCloudBridge } from './cloud-sync.js?v=20261028-8';

const KEY='everyword-v1',GUEST_KEY='everyword-guest-v1',GUEST_PROMPT='everyword-guest-welcome-shown-v1',USER_PREFIX='everyword-user-v1:',LEGACY_OWNER='everyword-legacy-owner-v1',root=document.querySelector('#app'),toastEl=document.querySelector('#toast');
let state=loadGuest(),accountId=null,page='home',queue=[],shown=false,flipped=false,practice=false,sessionRated=0,guestPrompted=localStorage.getItem(GUEST_PROMPT)==='1',done=new Set(),undo=null,modal=null,search='',fsrs=null,rating=null;
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
  return {cards:[...merged.values()]};
}
function switchAccount(user){
  const uid=user?.id||null;
  if(uid===accountId)return;
  const previous=accountId;
  if(!previous){try{localStorage.setItem(GUEST_KEY,JSON.stringify(state))}catch(e){console.error(e)}}
  accountId=uid;queue=[];shown=false;flipped=false;practice=false;sessionRated=0;undo=null;modal=null;page='home';search='';
  if(!uid){state=loadGuest();guestPrompted=localStorage.getItem(GUEST_PROMPT)==='1';render();return}
  let saved=loadAccount(uid);
  const owner=localStorage.getItem(LEGACY_OWNER);
  if(owner===uid)saved=mergeCardSets(saved,load());
  if(!previous){
    const guest=loadGuest();
    if(guest.cards.length){
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
function checked(){return state.cards.filter(c=>daily(c).length).length}
function tally(){let a=0,b=0;state.cards.forEach(c=>{const x=daily(c)[0];if(x){if(x.remembered)a++;else b++}});return [a,b]}
function due(c){return c.fsrs && new Date(c.fsrs.due)<=now()}
function fresh(c){return !c.fsrs}
function archive(c){return c.fsrs&&c.fsrs.scheduled_days>=30&&new Set((c.history||[]).filter(x=>x.remembered&&!x.practice).map(x=>x.at.slice(0,10))).size>=5}
function stats(){return {all:state.cards.length,new:state.cards.filter(fresh).length,due:state.cards.filter(due).length}}
function add(ru,en,example='',exampleRu='',note=''){ru=String(ru).trim();en=String(en).trim();if(!ru||!en)return false;if(state.cards.some(c=>norm(c.ru)===norm(ru)&&norm(c.en)===norm(en)))return false;state.cards.push({id:id(),ru,en,example,exampleRu,note,createdAt:now().toISOString(),updatedAt:now().toISOString(),fsrs:null,history:[]});return true}
function interleave(){const a=state.cards.filter(due).sort((x,y)=>new Date(x.fsrs.due)-new Date(y.fsrs.due));const b=state.cards.filter(fresh).sort((x,y)=>x.createdAt.localeCompare(y.createdAt));const out=[];while(a.length||b.length){if(a.length)out.push(a.shift().id);if(a.length)out.push(a.shift().id);if(b.length)out.push(b.shift().id)}return out}
function refill(){if(practice)return;const pending=new Set(queue);for(const k of interleave())if(!pending.has(k))queue.push(k)}
function current(){return state.cards.find(c=>c.id===queue[0])}
function begin(free=false){practice=free;sessionRated=0;queue=free?state.cards.map(c=>c.id):interleave();shown=false;flipped=false;page='study';render()}
function sidebar(){
  const menus=[['home','⌂ Главная'],['study','◇ Учить слова'],['library','▤ Мои слова'],['add','＋ Добавить'],['settings','⚙ Настройки']];
  return '<aside class="side"><div class="logo">everyword<small>MY ENGLISH SPACE</small></div><nav class="nav">'+
    menus.map(([p,t])=>'<button data-page="'+p+'" class="'+(page===p?'active':'')+'">'+t+'</button>').join('')+
    '<div class="nav-account"><button data-page="account" class="'+(page==='account'?'active':'')+'">◎ Аккаунт</button><span class="account-hint">'+(cloud.signedIn?'Вход выполнен':'Войти и сохранить прогресс')+'</span></div></nav></aside>';
}
function mobile(){
  return '<nav class="mobile">'+[['home','⌂ Главная'],['study','◇ Учить'],['library','▤ Слова'],['add','＋ Добавить'],['account','◎ Аккаунт']].map(([p,t])=>
    '<button data-page="'+p+'" class="'+(page===p?'active':'')+'">'+t+'</button>').join('')+'</nav>';
}
const heading=(k,t,s)=>'<div class="eyebrow">'+k+'</div><h1>'+t+'</h1><div class="muted">'+s+'</div>';
function dailyQuote(){const quotes=[
'Каждый маленький шаг приближает тебя к большой мечте.',
'Мечты становятся ближе, когда к ним возвращаются каждый день.',
'Сегодняшнее слово — ещё одна открытая дверь.',
'Большие перемены складываются из маленьких привычек.',
'Необязательно спешить, чтобы двигаться вперёд.',
'Каждый раз, когда ты возвращаешься к цели, ты становишься ближе.',
'Самые красивые путешествия начинаются с одного шага.',
'Маленькое действие сегодня важнее идеального плана на завтра.',
'Ты создаёшь своё будущее — слово за словом.',
'Достаточно сделать один шаг. Потом — следующий.',
'Мечта не требует спешки. Она требует движения.',
'То, что сегодня кажется трудным, однажды станет привычным.',
'Новые возможности начинаются с любопытства.',
'Даже тихий прогресс — всё равно прогресс.'
];const d=new Date();const day=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);return quotes[day%quotes.length]}
function home(){const s=stats(),[good,bad]=tally();return '<section class="home-heading"><div class="eyebrow">Личное пространство</div><h1 class="home-title"><span class="home-title-lead">Английский,</span><span class="home-title-tail">в своём ритме</span></h1><p class="muted home-subtitle">Все слова в одном месте. Возвращайся к ним на пути к европейскому паспорту.</p><span class="home-sun" aria-hidden="true"></span></section>'+'<div class="stats"><div class="stat"><span>Пора повторить</span><b>'+s.due+'</b><span>по расписанию</span></div><div class="stat"><span>Новых слов</span><b>'+s.new+'</b><span>ждут знакомства</span></div><div class="stat"><span>Коллекция</span><b>'+s.all+'</b><span>всего карточек</span></div></div><section class="hero"><div class="eyebrow">НАЧНИ СЕГОДНЯ</div><h2>'+(s.all?'Готова к новым словам?':'Начнём с первого слова')+'</h2><p>'+(s.all?'В ближайших занятиях будут все новые и все запланированные слова. Занимайся столько, сколько хочешь.':'Добавь слова из своего урока или попробуй демонстрационные карточки.')+'</p><div class="hero-actions"><button class="primary" data-action="'+(s.all?'begin':'samples')+'">'+(s.all?'Начать занятие →':'Добавить 6 примеров →')+'</button><button class="secondary" data-page="add">＋ Добавить слова</button></div></section><div class="panel" style="margin-top:20px"><h2>Сегодня</h2><p class="muted">Проверено слов: '+checked()+' · Вспомнила: '+good+' · Было сложно: '+bad+'</p><button class="secondary" data-action="practice">Свободная практика</button></div>'+'<footer class="daily-quote"><span class="daily-quote-mark" aria-hidden="true">✦</span><span>'+dailyQuote()+'</span></footer>'}
function study(){refill();const c=current();if(!c)return heading('МОЁ ЗАНЯТИЕ',practice?'Свободная практика':'Учить слова','Без фиксированного лимита.')+'<div class="panel" style="text-align:center;margin-top:25px"><h2>На сейчас всё!</h2><p class="muted">Нет карточек в очереди. Можешь добавить новые или потренироваться ещё.</p><button class="primary" data-page="add">Добавить слова</button> <button class="secondary" data-action="practice">Свободная практика</button></div>';return heading('МОЁ ЗАНЯТИЕ',practice?'Свободная практика':'Учить слова','Вспомни английский вариант. Оценивай именно первую попытку.')+'<div class="study"><div class="row"><span class="pill">'+(fresh(c)?'Новое слово':practice?'Тренировка':'Повторение')+'</span><span class="muted">В очереди: '+queue.length+' · Сегодня: '+checked()+'</span></div><div class="card '+(flipped?'revealed':'')+'" role="button" tabindex="0" data-action="flip"><div class="eyebrow">'+(flipped?'ENGLISH · ОТВЕТ':'РУССКИЙ · ПЕРЕВЕДИ НА АНГЛИЙСКИЙ')+'</div><div class="word">'+safe(flipped?c.en:c.ru)+'</div>'+(flipped?'<div class="example">'+safe(c.example||'')+'</div><div class="muted">'+safe(c.exampleRu||'')+'</div><div class="muted">'+safe(c.note||'')+'</div>':'')+'<small>↻ Нажимай, чтобы переворачивать</small></div><div class="actions"><button class="no" data-action="no" '+(!shown?'disabled':'')+'>✕ Не вспомнила</button><button class="yes" data-action="yes" '+(!shown?'disabled':'')+'>✓ Вспомнила</button></div><div class="row"><button class="link" data-action="skip">↔ Пропустить / следующая</button>'+(undo?'<button class="link" data-action="undo">↶ Отменить оценку</button>':'')+'</div>'+(fsrs||practice?'':'<div class="alert">Подключаем FSRS… Если библиотека недоступна, оценки не сохраняются. Проверь интернет.</div>')+'</div>'}
function library(){return heading('МОЯ КОЛЛЕКЦИЯ','Все слова','Цвет показывает последнюю оценку за сегодня, а не постоянный уровень знания.')+'<div class="stack"><input class="search" id="search" placeholder="Поиск по словам…" value="'+safe(search)+'" aria-label="Поиск"></div><div id="results">'+results()+'</div>'}
function results(){const v=state.cards.filter(c=>norm(c.ru+' '+c.en+' '+c.example).includes(norm(search)));return '<div class="grid">'+v.slice().reverse().map(c=>{const h=daily(c),s=h.length?h[h.length-1].remembered:null;return '<div class="wordrow"><div class="row"><strong>'+safe(c.en)+'</strong><span class="dot '+(s===true?'yes':s===false?'no':'')+'"></span></div><p class="ru">'+safe(c.ru)+'</p><div class="row"><small class="muted">'+(archive(c)?'Архив · редкие повторения':fresh(c)?'Новое':due(c)?'Пора повторить':'Повторение позже')+'</small><button class="link" data-action="edit" data-id="'+c.id+'">Изменить</button></div></div>'}).join('')+'</div>'+(v.length?'':'<p class="muted">Пока ничего не найдено.</p>')}
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
function authScreen(){
  const busy=cloud.status==='connecting'||(cloud.signedIn&&!cloud.ready&&cloud.status!=='error');
  const sent=cloud.status==='email-sent',failed=cloud.status==='error';
  return '<div class="auth-page"><div class="auth-shell"><div class="auth-symbol" aria-hidden="true"></div><div class="auth-logo">everyword<small>MY ENGLISH SPACE</small></div><div class="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО ДЛЯ АНГЛИЙСКОГО</div><h1 class="auth-title">'+(busy?'Открываем твой словарь': 'Английский,<span>в своём ритме</span>')+'</h1><p class="auth-intro">'+(busy?'Проверяем вход и загружаем твои слова…':'Твои слова, карточки и прогресс — в одном месте. Войди, чтобы продолжить с любого устройства.')+'</p>'+(busy?'<div class="auth-loader" role="status">Подключаем личную коллекцию…</div>':'<form class="auth-form" id="cloud-login"><label for="auth-email">Электронная почта</label><input id="auth-email" name="email" type="email" autocomplete="email" required placeholder="name@example.com"><button class="primary" type="submit">Получить ссылку для входа →</button></form>')+(sent?'<p class="auth-notice">Ссылка отправлена. Открой письмо на этом устройстве и перейди по ссылке — ты сразу окажешься в Everyword.</p>':'')+(failed?'<p class="auth-notice">Не удалось подключиться к аккаунту. Проверь интернет и попробуй снова.</p>':'')+'<p class="auth-footnote">Новый пользователь? Аккаунт создастся автоматически. После входа сайт будет узнавать тебя на этом устройстве.</p></div></div>'
}
const cloud=createCloudBridge({
  getCards:()=>state.cards,
  mergeCards:cards=>{state.cards=cards;try{if(accountId)localStorage.setItem(USER_PREFIX+accountId,JSON.stringify(state))}catch(e){console.error(e)}if(page==='study'&&!practice)refill();render()},
  onIdentity:switchAccount,
  onStatus:()=>{
    if(!cloud.signedIn||!cloud.ready||!appReadyShown||page==='settings'){
      render();
      if(cloud.signedIn&&cloud.ready)appReadyShown=true;
    }
  }
});
function render(){if(cloud.configured&&(!cloud.signedIn||(!cloud.ready&&cloud.status!=='error'))){root.innerHTML=authScreen();return}appReadyShown=true;root.innerHTML='<div class="app">'+sidebar()+'<main class="main">'+({home,study,library,add:addPage,settings}[page]||home)()+'</main>'+mobile()+'</div>'+(modal?'<div class="overlay"><div class="popup"><div class="eyebrow">ТВОЙ ПРОГРЕСС</div><b>'+modal+' карточек!</b><h2>Молодец!</h2><p class="muted">Сегодня ты проверила '+modal+' разных слов.</p><button class="primary" data-action="close">Продолжить →</button></div></div>':'')}
function flip(){flipped=!flipped;if(flipped)shown=true;render()}
function skip(){if(queue.length>1){queue.push(queue.shift());flipped=false;shown=false;undo=null;render()}else notify('Это пока единственная карточка')}
function grade(remembered){if(!shown)return;const c=current();if(!c)return;if(!practice&&!fsrs){notify('FSRS ещё не загрузился. Проверь интернет.');return}const before=checked();undo={card:structuredClone(c),queue:queue.slice()};if(!practice){try{const input=c.fsrs?{...c.fsrs,due:new Date(c.fsrs.due),last_review:c.fsrs.last_review?new Date(c.fsrs.last_review):undefined}:window.fsrsLib.createEmptyCard(new Date(c.createdAt));const result=fsrs.next(input,now(),remembered?rating.Good:rating.Again);c.fsrs={...result.card,due:result.card.due.toISOString(),last_review:result.card.last_review?.toISOString()||null}}catch(e){console.error(e);notify('Не удалось обновить FSRS. Оценка не сохранена.');return}}c.history.push({at:now().toISOString(),remembered,practice});c.updatedAt=now().toISOString();queue.shift();flipped=false;shown=false;save();refill();const after=checked();if(Math.floor(after/10)>Math.floor(before/10))modal=after;render()}
function doUndo(){if(!undo)return;const i=state.cards.findIndex(c=>c.id===undo.card.id);if(i>=0)state.cards[i]=undo.card;queue=undo.queue;shown=true;flipped=true;undo=null;modal=null;save();render()}
async function importData(file){if(!file)return;try{const x=JSON.parse(await file.text());if(!Array.isArray(x.cards))throw Error('Wrong format');const ids=new Set(state.cards.map(c=>c.id));let n=0;for(const c of x.cards){if(c.id&&c.ru&&c.en&&Array.isArray(c.history)&&!ids.has(c.id)){state.cards.push(c);ids.add(c.id);n++}}save();render();notify('Импортировано карточек: '+n)}catch{notify('Не удалось импортировать файл')}}
const examples=[['Разобраться, выяснить','figure out','I need to figure out what happened.','Мне нужно разобраться, что произошло.'],['Тем не менее','nevertheless','Nevertheless, I decided to go.','Тем не менее я решила пойти.'],['В итоге, со временем','eventually','Eventually, everything worked out.','В итоге всё получилось.'],['Случайно встретить','run into','I ran into an old friend.','Я случайно встретила старого друга.'],['Ладить с кем-то','get along with','I get along with my team.','Я хорошо лажу со своей командой.'],['Принимать как должное','take for granted',"Don't take it for granted.",'Не воспринимай это как должное.']];
document.addEventListener('click',e=>{const b=e.target.closest('[data-page],[data-action]');if(!b)return;if(b.dataset.page){page=b.dataset.page;if(page==='study'&&!queue.length){practice=false;queue=interleave()}render();return}const a=b.dataset.action;if(a==='begin')begin();else if(a==='practice')begin(true);else if(a==='samples'){examples.forEach(x=>add(...x));save();render();notify('Добавлено 6 примеров')}else if(a==='flip')flip();else if(a==='skip')skip();else if(a==='yes')grade(true);else if(a==='no')grade(false);else if(a==='undo')doUndo();else if(a==='cloud-refresh')cloud.refresh().then(()=>notify('Облако проверено')).catch(()=>notify('Ошибка обновления'));else if(a==='cloud-signout')cloud.signOut().then(()=>{render();notify('Выход выполнен')}).catch(()=>notify('Не удалось выйти из аккаунта'));else if(a==='close'){modal=null;render()}else if(a==='export'){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const u=URL.createObjectURL(blob);const link=document.createElement('a');link.href=u;link.download='everyword-backup-'+today()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(u),500)}else if(a==='edit'){const c=state.cards.find(x=>x.id===b.dataset.id);if(!c)return;const ru=prompt('Русский смысл',c.ru);if(ru===null)return;const en=prompt('Английское выражение',c.en);if(en===null)return;if(!ru.trim()||!en.trim()){notify('Оба поля обязательны');return}c.ru=ru.trim();c.en=en.trim();c.updatedAt=now().toISOString();save();render();notify('Карточка обновлена')}});
document.addEventListener('submit',e=>{if(e.target.id==='cloud-login'){e.preventDefault();const email=String(new FormData(e.target).get('email')||'').trim();cloud.signIn(email).then(()=>{render();notify('Ссылка отправлена на почту')}).catch(err=>notify(err?.message||'Не удалось отправить письмо'));return}if(!['single','bulk'].includes(e.target.id))return;e.preventDefault();const f=new FormData(e.target);let n=0;if(e.target.id==='single')n=Number(add(...['ru','en','example','exampleRu','note'].map(k=>String(f.get(k)||''))));else for(const line of String(f.get('bulk')||'').split(/\r?\n/)){const p=line.split('|').map(x=>x.trim());if(p.length>=2)n+=Number(add(...p.slice(0,5)))}save();e.target.reset();render();notify('Добавлено карточек: '+n)});
document.addEventListener('input',e=>{if(e.target.id==='search'){search=e.target.value;document.querySelector('#results').innerHTML=results()}});
document.addEventListener('change',e=>{if(e.target.id==='import')importData(e.target.files?.[0])});
document.addEventListener('keydown',e=>{if(page!=='study'||e.target.matches('input,textarea')||modal)return;if(e.key===' '||e.key==='Enter'){e.preventDefault();flip()}else if(['ArrowLeft','ArrowRight'].includes(e.key))skip();else if(e.key==='1')grade(false);else if(e.key==='2')grade(true)});
let startX=null;document.addEventListener('touchstart',e=>{if(e.target.closest('.card'))startX=e.touches[0].clientX},{passive:true});document.addEventListener('touchend',e=>{if(startX===null)return;const dx=e.changedTouches[0].clientX-startX;startX=null;if(Math.abs(dx)>65){e.preventDefault();skip()}},{passive:false});
render();
async function initialize(){for(const url of ['https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.2/dist/index.mjs','https://unpkg.com/ts-fsrs@5.4.2/dist/index.mjs','https://esm.sh/ts-fsrs@5.4.2?bundle'])try{const lib=await import(url);if(!lib.fsrs||!lib.createEmptyCard)continue;window.fsrsLib=lib;rating=lib.Rating;fsrs=lib.fsrs({request_retention:0.9,enable_short_term:true,learning_steps:['1m','10m'],relearning_steps:['10m'],enable_fuzz:true});render();return}catch(e){console.warn('FSRS source unavailable',e)}notify('Не удалось загрузить FSRS. Проверь интернет.');render()}
initialize();cloud.init();setInterval(()=>{if(page==='study'&&!practice){const x=queue.length;refill();if(queue.length!==x)render()}},30000);
