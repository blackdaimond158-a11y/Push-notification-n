const express     = require('express');
const admin       = require('firebase-admin');
const bodyParser  = require('body-parser');
const cors        = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ════════════════════════════════════════════════════════════
// ১. Firebase Admin Initialize
// ════════════════════════════════════════════════════════════
let serviceAccount = null;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require('./serviceAccountKey.json');
  }
} catch (e) {
  console.warn('⚠️ serviceAccountKey.json পাওয়া যায়নি:', e.message);
}

if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin সফলভাবে সংযুক্ত হয়েছে।');
  } catch (e) {
    console.error('❌ Firebase Admin init error:', e.message);
  }
}

const db = admin.apps.length ? admin.firestore() : null;
const memoryTokens = new Map();

// ════════════════════════════════════════════════════════════
// ২. Helper Functions
// ════════════════════════════════════════════════════════════
function isValidAppId(appId) {
  return Boolean(appId && /^[a-zA-Z0-9._\-]{3,100}$/.test(appId));
}

function tokenDocId(token) {
  return token.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
}

function devicesRef(appId) {
  return db ? db.collection('push_tokens').doc(appId).collection('devices') : null;
}

function appMetaRef(appId) {
  return db ? db.collection('push_app_meta').doc(appId) : null;
}

// ════════════════════════════════════════════════════════════
// ৩. Firebase Service Worker (SW) Endpoint
// ════════════════════════════════════════════════════════════
app.get('/firebase-messaging-sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

    const firebaseConfig = {
      apiKey: "AIzaSyBqSBOtWVx3ez5COJ1nMKb5VD94o2CZPJA",
      authDomain: "techxzone-e692e.firebaseapp.com",
      databaseURL: "https://techxzone-e692e-default-rtdb.firebaseio.com",
      projectId: "techxzone-e692e",
      storageBucket: "techxzone-e692e.firebasestorage.app",
      messagingSenderId: "376648087838",
      appId: "1:376648087838:web:abe7ba67487274e204710f",
      measurementId: "G-LWEC9VY323"
    };

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = (payload.data && payload.data.title) || (payload.notification && payload.notification.title) || 'Notification';
      const options = {
        body: (payload.data && payload.data.body) || (payload.notification && payload.notification.body) || '',
        icon: (payload.data && payload.data.imageUrl) || ''
      };
      self.registration.showNotification(title, options);
    });

    self.addEventListener('push', (event) => {
      if (event.data) {
        try {
          const payload = event.data.json();
          const title = (payload.data && payload.data.title) || (payload.notification && payload.notification.title) || 'Notification';
          const options = {
            body: (payload.data && payload.data.body) || (payload.notification && payload.notification.body) || '',
            icon: (payload.data && payload.data.imageUrl) || ''
          };
          event.waitUntil(self.registration.showNotification(title, options));
        } catch (e) {
          event.waitUntil(self.registration.showNotification('Notification', { body: event.data.text() }));
        }
      }
    });

    self.addEventListener('notificationclick', (event) => {
      event.notification.close();
      event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
          for (const client of clientList) {
            if (client.url && 'focus' in client) return client.focus();
          }
          if (clients.openWindow) return clients.openWindow('/');
        })
      );
    });
  `);
});

// ════════════════════════════════════════════════════════════
// ৪. মূল ওয়েব পেজ + নোটিফিকেশন সেন্ডার প্যানেল (GET /)
// ════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wevlo Push — Test Device & Sender</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0D1220; --surface:#141A2C; --surface-raised:#1C2439; --border:#2A3350;
    --text:#E8ECF5; --text-muted:#8C95B3; --text-dim:#5C6584;
    --signal:#46C9A5; --signal-soft:rgba(70,201,165,.14); --signal-bright:#6EEBC4;
    --alert:#FF6B5B; --alert-soft:rgba(255,107,91,.14);
    --radius-lg:16px;
  }
  *{box-sizing:border-box;}
  body{
    margin:0; background:radial-gradient(circle at 1px 1px, rgba(70,201,165,.06) 1px, transparent 1px) 0 0/28px 28px, var(--bg);
    color:var(--text); font-family:'IBM Plex Sans',system-ui,sans-serif; min-height:100vh;
  }
  .wrap{max-width:560px;margin:0 auto;padding:32px 20px 80px;}
  header{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
  .brand-mark{
    width:38px;height:38px;border-radius:10px;flex-shrink:0;
    background:linear-gradient(135deg, var(--signal), #2E9E82);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 0 0 1px rgba(70,201,165,.35), 0 8px 20px -8px rgba(70,201,165,.6);
  }
  .brand-mark svg{width:20px;height:20px;}
  h1{font-family:'Space Grotesk',sans-serif;font-size:19px;margin:0;font-weight:700;}
  header span{font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em;}
  p.lede{color:var(--text-muted);font-size:13.5px;line-height:1.6;margin:14px 0 26px;}

  .device-orb{width:120px;height:120px;margin:0 auto 24px;position:relative;display:flex;align-items:center;justify-content:center;}
  .device-orb .ring{position:absolute;inset:0;border-radius:50%;border:1px solid var(--border);}
  .device-orb .ring.r2{inset:14px;}
  .device-orb .core{
    width:64px;height:64px;border-radius:50%;background:var(--surface-raised);border:1.5px solid var(--border);
    display:flex;align-items:center;justify-content:center;font-size:26px;transition:border-color .3s, box-shadow .3s;
  }
  .device-orb.connected .core{border-color:var(--signal);box-shadow:0 0 0 6px var(--signal-soft);}
  .device-orb.connected .ring{border-color:rgba(70,201,165,.25);animation:orb-pulse 2.4s ease-out infinite;}
  .device-orb.connected .ring.r2{animation-delay:.6s;}
  @keyframes orb-pulse{0%{transform:scale(.85);opacity:.9;}100%{transform:scale(1.25);opacity:0;}}
  
  .status-line{text-align:center;font-size:13px;color:var(--text-muted);margin-bottom:26px;}
  .status-line b{color:var(--signal-bright);}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;margin-top:16px;}
  .card h2{font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;margin:0 0 12px;}
  label{display:block;font-size:12px;color:var(--text-muted);margin:12px 0 6px;}
  label:first-child{margin-top:0;}
  
  input[type=text],input[type=password],textarea,select{
    width:100%;background:var(--surface-raised);border:1px solid var(--border);
    border-radius:8px;padding:10px 12px;color:var(--text);font-size:13.5px;font-family:'IBM Plex Sans',sans-serif;
  }
  textarea{resize:vertical;min-height:60px;}
  input.mono{font-family:'JetBrains Mono',monospace;font-size:12px;}
  input:focus,textarea:focus,select:focus{outline:none;border-color:var(--signal);box-shadow:0 0 0 3px var(--signal-soft);}
  .field-row{display:flex;gap:10px;}
  .field-row > div{flex:1;}

  .btn{
    width:100%;display:flex;align-items:center;justify-content:center;gap:8px;
    background:linear-gradient(135deg, var(--signal), #2E9E82);color:#08150F;font-weight:600;
    border:none;padding:12px 16px;border-radius:8px;font-size:14px;cursor:pointer;margin-top:16px;
    font-family:'IBM Plex Sans',sans-serif;transition:filter .12s;
  }
  .btn:hover{filter:brightness(1.06);}
  .btn:active{transform:scale(.99);}
  .btn[disabled]{opacity:.5;cursor:not-allowed;}
  .btn.secondary{background:var(--surface-raised);color:var(--text);border:1px solid var(--border);margin-top:10px;}
  .btn.send-btn{background:linear-gradient(135deg, #6366F1, #4F46E5);color:#fff;}

  .token-box{background:#090D17;border:1px solid var(--border);border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:11px;word-break:break-all;color:var(--text-muted);max-height:70px;overflow-y:auto;}
  .copy-hint{font-size:11px;color:var(--text-dim);margin-top:6px;}
  a.copy-hint{color:var(--signal);cursor:pointer;text-decoration:none;}
  
  .feed{display:flex;flex-direction:column;gap:10px;max-height:340px;overflow-y:auto;}
  .feed-empty{text-align:center;padding:34px 14px;color:var(--text-dim);font-size:13px;border:1px dashed var(--border);border-radius:12px;}
  .notif{background:var(--surface-raised);border:1px solid var(--border);border-left:3px solid var(--signal);border-radius:8px;padding:12px 14px;animation:slide-in .25s ease-out;}
  @keyframes slide-in{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}
  .notif .title{font-weight:600;font-size:13.5px;margin-bottom:3px;}
  .notif .body{font-size:12.5px;color:var(--text-muted);line-height:1.5;}
  .notif img{max-width:100%;border-radius:6px;margin-top:8px;display:block;}
  .notif .time{font-size:10.5px;color:var(--text-dim);margin-top:6px;font-family:'JetBrains Mono',monospace;}

  .msg{font-size:12px;padding:10px 12px;border-radius:8px;margin-top:12px;}
  .msg.err{background:var(--alert-soft);color:#FFB4AA;border:1px solid rgba(255,107,91,.3);}
  .msg.ok{background:var(--signal-soft);color:var(--signal-bright);border:1px solid rgba(70,201,165,.3);}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand-mark">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2 L12 14" stroke="#08150F" stroke-width="2" stroke-linecap="round"/>
        <path d="M6 8 C6 4.7 8.7 2 12 2 C15.3 2 18 4.7 18 8" stroke="#08150F" stroke-width="2" stroke-linecap="round" fill="none"/>
        <circle cx="12" cy="19" r="2.4" fill="#08150F"/>
      </svg>
    </div>
    <div><h1>Wevlo Push</h1><span>Test Device & Sender</span></div>
  </header>
  <p class="lede">এই পেজ থেকে আপনি একই সাথে ডিভাইস কানেক্ট করতে পারবেন এবং সরাসরি টেস্ট নোটিফিকেশন পাঠাতে পারবেন।</p>

  <div class="device-orb" id="orb">
    <div class="ring"></div>
    <div class="ring r2"></div>
    <div class="core" id="orbIcon">📴</div>
  </div>
  <div class="status-line" id="statusLine">ডিভাইস সংযুক্ত নয়</div>

  <!-- ১. ডিভাইস কানেকশন -->
  <div class="card" id="setupCard">
    <h2>১. পুশ সার্ভার কনফিগারেশন</h2>
    <label>Server Base URL</label>
    <input type="text" id="baseUrl" class="mono" value="">
    <div class="field-row">
      <div>
        <label>App ID (Package Name)</label>
        <input type="text" id="appId" class="mono" value="com.techxzone.app">
      </div>
      <div>
        <label>পাসওয়ার্ড <span style="color:var(--text-dim);">(ঐচ্ছিক)</span></label>
        <input type="password" id="appPassword" placeholder="যদি সেট করা থাকে">
      </div>
    </div>

    <h2 style="margin-top:22px;">২. VAPID Key</h2>
    <label>VAPID Key</label>
    <input type="text" id="fbVapidKey" class="mono" value="BDwyvl6YdvBEhXdyP2ks6XnKliJJYjS35J84_v9tShvjJV1n5Vod8Di2G_gaZFoECHZN2Gof6hpoSaGImZ59QSA">

    <button class="btn" id="connectBtn" onclick="connectDevice()">নোটিফিকেশন পারমিশন দিন ও কানেক্ট করুন</button>
    <div id="setupMsg"></div>
  </div>

  <!-- টোকেন ইনফো -->
  <div class="card" id="connectedCard" style="display:none;">
    <h2>ডিভাইস টোকেন</h2>
    <div class="token-box" id="tokenBox">—</div>
    <div class="copy-hint"><a onclick="copyToken()">টোকেন কপি করুন</a></div>
    <button class="btn secondary" onclick="disconnectDevice()">ডিসকানেক্ট করুন</button>
  </div>

  <!-- ২. নোটিফিকেশন সেন্ড প্যানেল (নতুন যুক্ত করা হয়েছে) -->
  <div class="card" style="border-color: rgba(99, 102, 241, 0.4);">
    <h2 style="color: #A5B4FC;">🚀 নোটিফিকেশন পাঠান (Send Panel)</h2>
    
    <label>টার্গেট টাইপ</label>
    <select id="sendTargetType" onchange="toggleTargetField()">
      <option value="all">📢 App ID-র সকল ডিভাইসে পাঠান (/send-all)</option>
      <option value="single">🎯 শুধু কানেক্টেড / নির্দিষ্ট টোকেনে পাঠান (/send-notification)</option>
    </select>

    <div id="singleTokenRow" style="display:none;">
      <label>ডিভাইস টোকেন</label>
      <input type="text" id="sendTargetToken" class="mono" placeholder="টোকেন পেস্ট করুন">
    </div>

    <label>নোটিফিকেশন টাইটেল</label>
    <input type="text" id="sendTitle" value="অভিনন্দন! 🎉" placeholder="যেমন: নতুন অফার!">

    <label>নোটিফিকেশন মেসেজ (Body)</label>
    <textarea id="sendBody" placeholder="আপনার মেসেজ লিখুন...">আপনার পুশ নোটিফিকেশন সফলভাবে কাজ করছে!</textarea>

    <label>ছবি / আইকন URL <span style="color:var(--text-dim);">(ঐচ্ছিক)</span></label>
    <input type="text" id="sendImageUrl" placeholder="https://cdn-icons-png.flaticon.com/512/1827/1827392.png" value="https://cdn-icons-png.flaticon.com/512/1827/1827392.png">

    <button class="btn send-btn" id="sendMsgBtn" onclick="sendPushNotification()">এখনই নোটিফিকেশন পাঠান</button>
    <div id="sendResultMsg"></div>
  </div>

  <!-- ৩. রিসিভড নোটিফিকেশন ফিড -->
  <div class="card">
    <h2>রিসিভড নোটিফিকেশন</h2>
    <div class="feed" id="feed">
      <div class="feed-empty">এখনো কোনো নোটিফিকেশন আসেনি।</div>
    </div>
  </div>
</div>

<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"></script>
<script>
let currentToken = null;
document.getElementById('baseUrl').value = window.location.origin;

const firebaseConfig = {
  apiKey: "AIzaSyBqSBOtWVx3ez5COJ1nMKb5VD94o2CZPJA",
  authDomain: "techxzone-e692e.firebaseapp.com",
  databaseURL: "https://techxzone-e692e-default-rtdb.firebaseio.com",
  projectId: "techxzone-e692e",
  storageBucket: "techxzone-e692e.firebasestorage.app",
  messagingSenderId: "376648087838",
  appId: "1:376648087838:web:abe7ba67487274e204710f",
  measurementId: "G-LWEC9VY323"
};

function setMsg(elId, text, ok){
  const el = document.getElementById(elId);
  el.innerHTML = '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + text + '</div>';
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
}

function toggleTargetField(){
  const type = document.getElementById('sendTargetType').value;
  document.getElementById('singleTokenRow').style.display = (type === 'single') ? 'block' : 'none';
  if(type === 'single' && currentToken){
    document.getElementById('sendTargetToken').value = currentToken;
  }
}

async function connectDevice(){
  const btn = document.getElementById('connectBtn');
  const baseUrl = document.getElementById('baseUrl').value.replace(/\\/+$/, '');
  const pushAppId = document.getElementById('appId').value.trim();
  const password = document.getElementById('appPassword').value;
  const vapidKey = document.getElementById('fbVapidKey').value.trim();

  if(!pushAppId){ setMsg('setupMsg', 'App ID দিন', false); return; }
  if(!vapidKey){ setMsg('setupMsg', 'VAPID Key দিন', false); return; }
  if(!('serviceWorker' in navigator)){ setMsg('setupMsg', 'এই ব্রাউজার Service Worker সাপোর্ট করে না', false); return; }

  btn.disabled = true;
  setMsg('setupMsg', 'পারমিশন চাওয়া হচ্ছে…', true);

  try{
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){
      setMsg('setupMsg', 'নোটিফিকেশন পারমিশন দেওয়া হয়নি — ব্রাউজার সেটিংস থেকে অনুমতি দিন', false);
      btn.disabled = false;
      return;
    }

    const existing = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (existing) { await existing.unregister(); }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const messaging = firebase.messaging();

    const token = await messaging.getToken({ vapidKey, serviceWorkerRegistration: registration });
    if(!token){
      setMsg('setupMsg', 'টোকেন পাওয়া যায়নি — Firebase কনফিগারেশন যাচাই করুন', false);
      btn.disabled = false;
      return;
    }
    currentToken = token;

    const res = await fetch(baseUrl + '/register-token', {
      method:'POST', 
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token, appId: pushAppId, userAgent: navigator.userAgent, ...(password ? {password} : {}) })
    });
    const data = await res.json();
    if(!data.success){
      setMsg('setupMsg', 'সার্ভারে রেজিস্টার ব্যর্থ: ' + (data.error || 'Unknown error'), false);
      btn.disabled = false;
      return;
    }

    document.getElementById('orb').classList.add('connected');
    document.getElementById('orbIcon').textContent = '📶';
    document.getElementById('statusLine').innerHTML = '<b>' + escapeHtml(pushAppId) + '</b> এ সংযুক্ত ও লাইভ';
    document.getElementById('tokenBox').textContent = token;
    document.getElementById('connectedCard').style.display = 'block';
    document.getElementById('sendTargetToken').value = token;
    setMsg('setupMsg', 'সফলভাবে কানেক্ট হয়েছে!', true);

    messaging.onMessage((payload) => {
      addToFeed(payload.data || {});
      if(Notification.permission === 'granted' && document.visibilityState === 'visible'){
        registration.showNotification((payload.data && payload.data.title) || 'নোটিফিকেশন', {
          body: (payload.data && payload.data.body) || '',
          icon: payload.data && payload.data.imageUrl
        });
      }
    });

  }catch(e){
    setMsg('setupMsg', 'কানেক্ট করতে ব্যর্থ: ' + e.message, false);
  }finally{
    btn.disabled = false;
  }
}

async function sendPushNotification(){
  const btn = document.getElementById('sendMsgBtn');
  const baseUrl = document.getElementById('baseUrl').value.replace(/\\/+$/, '');
  const pushAppId = document.getElementById('appId').value.trim();
  const targetType = document.getElementById('sendTargetType').value;
  const title = document.getElementById('sendTitle').value.trim();
  const body = document.getElementById('sendBody').value.trim();
  const imageUrl = document.getElementById('sendImageUrl').value.trim();

  if(!title){ setMsg('sendResultMsg', 'টাইটেল লিখুন', false); return; }

  btn.disabled = true;
  setMsg('sendResultMsg', 'পাঠানো হচ্ছে…', true);

  try{
    let url = baseUrl + '/send-all';
    let payload = { appId: pushAppId, title, body, imageUrl };

    if(targetType === 'single'){
      const token = document.getElementById('sendTargetToken').value.trim();
      if(!token){
        setMsg('sendResultMsg', 'টার্গেট ডিভাইস টোকেন প্রয়োজন', false);
        btn.disabled = false;
        return;
      }
      url = baseUrl + '/send-notification';
      payload = { token, title, body, imageUrl };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if(data.success){
      const extra = (data.total !== undefined) ? ' (মোট: ' + data.total + ', সফল: ' + data.successCount + ')' : '';
      setMsg('sendResultMsg', '🎉 নোটিফিকেশন সফলভাবে পাঠানো হয়েছে!' + extra, true);
    }else{
      setMsg('sendResultMsg', 'পাঠাতে সমস্যা হয়েছে: ' + (data.error || 'Server error'), false);
    }
  }catch(e){
    setMsg('sendResultMsg', 'রিকোয়েস্ট ফেইল্ড: ' + e.message, false);
  }finally{
    btn.disabled = false;
  }
}

function addToFeed(data){
  const feed = document.getElementById('feed');
  if(feed.querySelector('.feed-empty')) feed.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'notif';
  const time = new Date().toLocaleTimeString('en-GB');
  card.innerHTML = 
    '<div class="title">' + escapeHtml(data.title || 'নোটিফিকেশন') + '</div>' +
    '<div class="body">' + escapeHtml(data.body || '') + '</div>' +
    (data.imageUrl ? '<img src="' + escapeHtml(data.imageUrl) + '" alt="">' : '') +
    '<div class="time">' + time + '</div>';
  feed.prepend(card);
}

function copyToken(){
  if(!currentToken) return;
  navigator.clipboard.writeText(currentToken);
  setMsg('setupMsg', 'টোকেন কপি হয়েছে', true);
}

function disconnectDevice(){
  document.getElementById('orb').classList.remove('connected');
  document.getElementById('orbIcon').textContent = '📴';
  document.getElementById('statusLine').textContent = 'ডিভাইস সংযুক্ত নয়';
  document.getElementById('connectedCard').style.display = 'none';
  currentToken = null;
  setMsg('setupMsg', 'ডিসকানেক্ট হয়েছে', true);
}
</script>
</body>
</html>`);
});

// ════════════════════════════════════════════════════════════
// ৫. API Routes
// ════════════════════════════════════════════════════════════

// ── Debug Route ──
app.get('/debug', (req, res) => {
  res.json({
    firebase_connected: Boolean(admin.apps.length),
    project_id:         serviceAccount ? serviceAccount.project_id : null,
    client_email:       serviceAccount ? serviceAccount.client_email : null,
    private_key_id:     serviceAccount ? serviceAccount.private_key_id : null,
    active_memory_apps: Array.from(memoryTokens.keys())
  });
});

// ── App Status ──
app.get('/app-status', async (req, res) => {
  const { appId } = req.query;
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  try {
    let registered = false;
    let registeredAt = null;
    let tokenCount = 0;

    if (db) {
      const metaDoc   = await appMetaRef(appId).get();
      const tokenSnap = await devicesRef(appId).get();
      registered   = metaDoc.exists;
      registeredAt = metaDoc.exists ? metaDoc.data().registeredAt : null;
      tokenCount   = tokenSnap.size;
    } else {
      registered = memoryTokens.has(appId);
      tokenCount = memoryTokens.has(appId) ? memoryTokens.get(appId).size : 0;
    }

    res.json({
      success: true,
      appId,
      registered,
      registeredAt,
      tokenCount
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Register App ──
app.post('/register-app', async (req, res) => {
  const { appId } = req.body;
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  try {
    if (db) {
      const ref = appMetaRef(appId);
      const doc = await ref.get();
      await ref.set({
        appId,
        registeredAt: doc.exists ? doc.data().registeredAt : Date.now(),
        updatedAt:    Date.now()
      }, { merge: true });
    }
    console.log(`[${appId}] App registered/updated`);
    res.json({ success: true, message: 'app registered' });
  } catch (e) {
    console.error('Register-app error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Register Token ──
app.post('/register-token', async (req, res) => {
  const { token, appId, userAgent } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  // মেমোরি স্টোরেজ আপডেট
  if (!memoryTokens.has(appId)) {
    memoryTokens.set(appId, new Set());
  }
  memoryTokens.get(appId).add(token);

  // Firestore আপডেট
  if (db) {
    try {
      await devicesRef(appId).doc(tokenDocId(token)).set({
        token,
        appId,
        userAgent:    userAgent || '',
        registeredAt: Date.now(),
        updatedAt:    Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore write warning:', e.message);
    }
  }

  console.log(`[${appId}] Token registered: ${token.substring(0, 20)}...`);
  res.json({ success: true });
});

// ── Get Tokens ──
app.get('/tokens', async (req, res) => {
  const { appId } = req.query;
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  try {
    let tokens = [];
    if (db) {
      const snap = await devicesRef(appId).get();
      tokens = snap.docs.map(d => ({
        token:        d.data().token,
        registeredAt: d.data().registeredAt,
        userAgent:    d.data().userAgent || ''
      }));
    } else if (memoryTokens.has(appId)) {
      tokens = Array.from(memoryTokens.get(appId)).map(t => ({
        token: t,
        registeredAt: Date.now(),
        userAgent: ''
      }));
    }

    res.json({ success: true, appId, count: tokens.length, tokens });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Send Notification to single token ──
app.post('/send-notification', async (req, res) => {
  const { token, title, body, imageUrl } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  if (!admin.apps.length) return res.status(500).json({ success: false, error: 'Firebase Admin not initialized' });

  try {
    const message = {
      token,
      data: { 
        title: String(title || 'Notification'), 
        body: String(body || ''), 
        ...(imageUrl ? { imageUrl: String(imageUrl) } : {}) 
      },
      android: { priority: 'high' }
    };

    const msgId = await admin.messaging().send(message);
    res.json({ success: true, messageId: msgId });
  } catch (e) {
    console.error('Send error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Send to All tokens of an appId ──
app.post('/send-all', async (req, res) => {
  const { appId, title, body, imageUrl } = req.body;
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });
  if (!admin.apps.length) return res.status(500).json({ success: false, error: 'Firebase Admin not initialized' });

  let tokens = [];
  let tokenDocs = [];

  if (db) {
    try {
      const snap = await devicesRef(appId).get();
      tokenDocs = snap.docs;
      tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    } catch (e) {
      console.warn('Firestore read error, using memory fallback:', e.message);
    }
  }

  if (tokens.length === 0 && memoryTokens.has(appId)) {
    tokens = Array.from(memoryTokens.get(appId));
  }

  if (tokens.length === 0) {
    return res.json({ success: false, error: 'No tokens found for this app' });
  }

  const messages = tokens.map(token => ({
    token,
    data: { 
      title: String(title || 'Notification'), 
      body: String(body || ''), 
      ...(imageUrl ? { imageUrl: String(imageUrl) } : {}) 
    },
    android: { priority: 'high' }
  }));

  try {
    const result = await admin.messaging().sendEach(messages);
    console.log(`[${appId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    if (db && tokenDocs.length > 0) {
      const batch = db.batch();
      let removed = 0;
      result.responses.forEach((r, i) => {
        if (!r.success && tokenDocs[i]) {
          batch.delete(tokenDocs[i].ref);
          removed++;
        }
      });
      if (removed > 0) await batch.commit();
    }

    res.json({
      success:      true,
      appId,
      total:        tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Delete a token ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  if (!isValidAppId(appId) || !token) return res.status(400).json({ success: false, error: 'appId and token required' });

  try {
    if (memoryTokens.has(appId)) {
      memoryTokens.get(appId).delete(token);
    }
    if (db) {
      await devicesRef(appId).doc(tokenDocId(token)).delete();
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// ৬. Server Start
// ════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`🚀 Wevlo Push Server running on port ${PORT}`));
