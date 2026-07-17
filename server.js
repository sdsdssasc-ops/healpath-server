const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'healpath-secret-key-2026';

// ===== المسارات =====
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DATA_DIR = path.join(BASE_DIR, 'data');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');

// إنشاء المجلدات لو ما موجودة
[DATA_DIR, PUBLIC_DIR, VIDEOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ===== ملفات البيانات =====
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// لو الملفات ما موجودة، سويها فاضية
[USERS_FILE, CHATS_FILE].forEach(file => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
});

function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } 
    catch { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());
app.use('/videos', express.static(VIDEOS_DIR));

// ===== التحقق من تسجيل الدخول =====
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'توكن غير صالح' }); }
}

// ===== API: تسجيل =====
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });

    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'اسم المستخدم مستخدم' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: Date.now().toString(),
        username,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
        videosWatched: 0,
        streak: 0,
        lastVisit: null
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);

    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET);
    res.json({ token, user: { id: newUser.id, username: newUser.username } });
});

// ===== API: دخول =====
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: 'المستخدم غير موجود' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'كلمة المرور غير صحيحة' });

    // تحديث التتابع اليومي
    const today = new Date().toDateString();
    if (user.lastVisit !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        user.streak = (user.lastVisit === yesterday.toDateString()) ? (user.streak || 0) + 1 : 1;
        user.lastVisit = today;
        writeJSON(USERS_FILE, users);
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ 
        token, 
        user: { 
            id: user.id, 
            username: user.username,
            daysRecovery: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000*60*60*24)),
            videosWatched: user.videosWatched || 0,
            streak: user.streak || 0
        } 
    });
});

// ===== API: بياناتي =====
app.get('/api/me', authMiddleware, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'غير موجود' });
    res.json({
        id: user.id,
        username: user.username,
        daysRecovery: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000*60*60*24)),
        videosWatched: user.videosWatched || 0,
        streak: user.streak || 0
    });
});

// ===== API: الفيديوهات (للجميع - بدون تسجيل) =====
app.get('/api/videos', (req, res) => {
    const videos = [
        { id: '1', title: 'جلسة التنفس العميق', desc: 'تعلم تقنيات التنفس للاسترخاء', duration: '15:30', src: '/videos/video1.mp4', views: 1240 },
        { id: '2', title: 'التأمل الصباحي', desc: 'ابدأ يومك بهدوء وتركيز', duration: '10:00', src: '/videos/video2.mp4', views: 890 },
        { id: '3', title: 'تمارين الاسترخاء', desc: 'تخلص من التوتر والقلق', duration: '20:45', src: '/videos/video3.mp4', views: 2100 },
        { id: '4', title: 'النوم الصحي', desc: 'نصائح لنوم هادئ ومريح', duration: '12:15', src: '/videos/video4.mp4', views: 1560 },
        { id: '5', title: 'التحكم بالغضب', desc: 'تقنيات إدارة الغضب بفعالية', duration: '18:20', src: '/videos/video5.mp4', views: 980 },
        { id: '6', title: 'التفكير الإيجابي', desc: 'بني عقلية إيجابية', duration: '14:50', src: '/videos/video6.mp4', views: 3200 }
    ];
    res.json(videos);
});

// ===== API: مشاهدة فيديو =====
app.post('/api/videos/:id/watch', authMiddleware, (req, res) => {
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (user) { user.videosWatched = (user.videosWatched || 0) + 1; writeJSON(USERS_FILE, users); }
    res.json({ success: true });
});

// ===== صفحة تسجيل الدخول =====
const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HealPath - تسجيل الدخول</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
:root{--primary:#2D8B5E;--primary-light:#3BA870;--card-bg:#FFFFFF;--bg:#F0F4F0;--text:#1A1A2E;--text-light:#6B7280;--border:#E5E7EB}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Tajawal',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1E6B47 0%,#2D8B5E 50%,#3BA870 100%)}
.login-box{background:var(--card-bg);border-radius:16px;padding:40px;width:100%;max-width:420px;box-shadow:0 10px 40px rgba(0,0,0,0.12);margin:20px}
.logo{text-align:center;margin-bottom:35px}
.logo i{font-size:50px;color:var(--primary);margin-bottom:10px;display:block}
.logo h1{font-size:32px;font-weight:800;color:var(--primary)}
.logo p{color:var(--text-light);font-size:15px}
.input-group{position:relative;margin-bottom:20px}
.input-group i{position:absolute;right:16px;top:50%;transform:translateY(-50%);color:var(--text-light)}
.input-group input{width:100%;padding:14px 45px 14px 16px;border:2px solid var(--border);border-radius:10px;font-family:'Tajawal',sans-serif;font-size:15px;background:var(--bg)}
.input-group input:focus{outline:none;border-color:var(--primary)}
.login-btn{width:100%;padding:14px;background:linear-gradient(135deg,var(--primary),var(--primary-light));color:white;border:none;border-radius:10px;font-family:'Tajawal',sans-serif;font-size:16px;font-weight:700;cursor:pointer}
.register-link{text-align:center;margin-top:20px;color:var(--text-light);font-size:14px}
.register-link a{color:var(--primary);text-decoration:none;font-weight:700}
.notification{position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:15px 30px;border-radius:10px;color:white;font-weight:700;z-index:9999}
</style>
</head>
<body>
<div class="login-box">
<div class="logo"><i class="fas fa-leaf"></i><h1>HealPath</h1><p>مسارك نحو التعافي</p></div>
<form id="loginForm">
<div class="input-group"><i class="fas fa-user"></i><input type="text" id="username" placeholder="اسم المستخدم" required></div>
<div class="input-group"><i class="fas fa-lock"></i><input type="password" id="password" placeholder="كلمة المرور" required></div>
<button type="submit" class="login-btn" id="loginBtn"><i class="fas fa-sign-in-alt"></i> دخول</button>
</form>
<p class="register-link">ما عندك حساب؟ <a href="#" onclick="showRegister()">سجل الآن</a></p>
</div>
<div id="registerModal" style="display:none;position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.5);align-items:center;justify-content:center">
<div style="background:white;padding:30px;border-radius:16px;width:90%;max-width:400px;position:relative">
<span onclick="closeRegister()" style="position:absolute;left:20px;top:20px;font-size:28px;cursor:pointer">&times;</span>
<h2 style="color:#2D8B5E;margin-bottom:20px"><i class="fas fa-user-plus"></i> تسجيل حساب جديد</h2>
<form id="registerForm">
<div class="input-group"><i class="fas fa-user"></i><input type="text" id="regUsername" placeholder="اسم المستخدم" required></div>
<div class="input-group"><i class="fas fa-lock"></i><input type="password" id="regPassword" placeholder="كلمة المرور" required></div>
<button type="submit" class="login-btn"><i class="fas fa-check"></i> تسجيل</button>
</form>
</div>
</div>
<script>
const API_URL='';
function showNotification(m,t){const n=document.createElement('div');n.className='notification';n.style.background=t==='success'?'#2D8B5E':'#EF4444';n.textContent=m;document.body.appendChild(n);setTimeout(()=>n.remove(),3000)}
function showRegister(){document.getElementById('registerModal').style.display='flex'}
function closeRegister(){document.getElementById('registerModal').style.display='none'}
document.getElementById('loginForm').addEventListener('submit',async function(e){e.preventDefault();try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value})});const d=await r.json();if(r.ok){localStorage.setItem('healpath_token',d.token);localStorage.setItem('healpath_user',JSON.stringify(d.user));showNotification('تم تسجيل الدخول!','success');setTimeout(()=>window.location.href='/dashboard',500)}else{showNotification(d.error||'خطأ','error')}}catch(err){showNotification('خطأ في الاتصال','error')}});
document.getElementById('registerForm').addEventListener('submit',async function(e){e.preventDefault();const u=document.getElementById('regUsername').value.trim(),p=document.getElementById('regPassword').value;if(u.length<3){showNotification('اسم المستخدم قصير','error');return}if(p.length<4){showNotification('كلمة المرور قصيرة','error');return}try{const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(r.ok){localStorage.setItem('healpath_token',d.token);localStorage.setItem('healpath_user',JSON.stringify(d.user));showNotification('تم إنشاء الحساب!','success');setTimeout(()=>window.location.href='/dashboard',500)}else{showNotification(d.error||'خطأ','error')}}catch(err){showNotification('خطأ في الاتصال','error')}});
</script>
</body>
</html>`;

// ===== صفحة الداشبورد =====
const DASHBOARD_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HealPath - لوحة التحكم</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
:root { --primary: #2D8B5E; --primary-light: #3BA870; --primary-dark: #1E6B47; --secondary: #E8F5E9; --accent: #FF8C42; --bg: #F0F4F0; --card-bg: #FFFFFF; --text: #1A1A2E; --text-light: #6B7280; --border: #E5E7EB; --shadow: 0 4px 20px rgba(0,0,0,0.08); }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Tajawal', sans-serif; background: var(--bg); color: var(--text); }
.sidebar { position: fixed; right: 0; top: 0; width: 260px; height: 100vh; background: var(--card-bg); box-shadow: var(--shadow); z-index: 100; display: flex; flex-direction: column; }
.sidebar-header { padding: 25px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border); }
.sidebar-header i { font-size: 28px; color: var(--primary); }
.sidebar-header span { font-size: 22px; font-weight: 800; color: var(--primary); }
.sidebar-nav { flex: 1; padding: 15px 10px; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 14px 18px; margin-bottom: 5px; border-radius: 10px; color: var(--text-light); border: none; background: none; width: 100%; font-family: 'Tajawal'; font-size: 15px; cursor: pointer; }
.nav-item:hover { background: var(--secondary); color: var(--primary); }
.nav-item.active { background: linear-gradient(135deg, var(--primary), var(--primary-light)); color: white; }
.nav-item i { font-size: 18px; width: 24px; text-align: center; }
.sidebar-footer { padding: 15px; border-top: 1px solid var(--border); }
.user-info { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding: 10px; background: var(--bg); border-radius: 10px; }
.user-info i { font-size: 28px; color: var(--primary); }
.logout-btn { width: 100%; padding: 10px; background: transparent; border: 2px solid #EF4444; color: #EF4444; border-radius: 10px; font-family: 'Tajawal'; font-weight: 700; cursor: pointer; }
.logout-btn:hover { background: #EF4444; color: white; }
.main-content { margin-right: 260px; min-height: 100vh; }
.top-bar { background: var(--card-bg); padding: 20px 30px; display: flex; justify-content: space-between; align-items: center; box-shadow: var(--shadow); position: sticky; top: 0; z-index: 50; }
.content-section { display: none; padding: 30px; }
.content-section.active { display: block; }
.welcome-card { background: linear-gradient(135deg, var(--primary), var(--primary-light)); border-radius: 16px; padding: 30px; display: flex; justify-content: space-between; color: white; margin-bottom: 25px; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 30px; }
.stat-card { background: var(--card-bg); border-radius: 16px; padding: 25px; display: flex; align-items: center; gap: 15px; box-shadow: var(--shadow); }
.stat-card i { font-size: 32px; color: var(--primary); width: 50px; height: 50px; background: var(--secondary); border-radius: 12px; display: flex; align-items: center; justify-content: center; }
.stat-info h3 { font-size: 28px; font-weight: 800; color: var(--primary); }
.quick-actions { background: var(--card-bg); border-radius: 16px; padding: 25px; box-shadow: var(--shadow); }
.actions-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
.action-card { background: var(--bg); border-radius: 10px; padding: 25px; text-align: center; cursor: pointer; border: none; font-family: 'Tajawal'; }
.action-card:hover { border: 2px solid var(--primary); background: var(--secondary); }
.action-card i { font-size: 28px; color: var(--primary); margin-bottom: 10px; display: block; }
.videos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
.video-card { background: var(--card-bg); border-radius: 16px; overflow: hidden; box-shadow: var(--shadow); }
.video-thumbnail { position: relative; height: 180px; background: linear-gradient(135deg, var(--primary-dark), var(--primary)); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.video-thumbnail i { font-size: 50px; color: white; }
.play-btn { position: absolute; width: 60px; height: 60px; background: rgba(255,255,255,0.9); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.play-btn i { font-size: 24px; color: var(--primary); }
.video-info { padding: 18px; }
.video-meta { display: flex; gap: 15px; margin-top: 10px; color: var(--text-light); font-size: 13px; }
.video-modal { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); align-items: center; justify-content: center; }
.video-modal.show { display: flex; }
.video-modal-content { width: 80%; max-width: 900px; position: relative; }
.video-modal-content video { width: 100%; border-radius: 16px; }
.progress-ring { position: relative; width: 180px; height: 180px; margin: 0 auto; }
.progress-ring svg { transform: rotate(-90deg); width: 100%; height: 100%; }
.progress-fill { fill: none; stroke: var(--primary); stroke-width: 8; stroke-linecap: round; stroke-dasharray: 339.292; stroke-dashoffset: 339.292; transition: 1s; }
.milestone { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg); border-radius: 10px; }
.milestone.completed { background: var(--secondary); }
.milestone.completed i { color: var(--primary); }
.progress-container { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; }
.progress-card { background: var(--card-bg); border-radius: 16px; padding: 30px; box-shadow: var(--shadow); text-align: center; }
@media (max-width: 900px) { .sidebar { width: 70px; } .sidebar-header span, .nav-item span, .user-info span { display: none; } .main-content { margin-right: 70px; } .stats-grid { grid-template-columns: repeat(2, 1fr); } .actions-grid { grid-template-columns: repeat(2, 1fr); } .progress-container { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<aside class="sidebar">
<div class="sidebar-header"><i class="fas fa-leaf"></i><span>HealPath</span></div>
<nav class="sidebar-nav">
<button class="nav-item active" onclick="showSection('home')"><i class="fas fa-home"></i><span>الرئيسية</span></button>
<button class="nav-item" onclick="showSection('videos')"><i class="fas fa-video"></i><span>جلسات الفيديو</span></button>
<button class="nav-item" onclick="showSection('progress')"><i class="fas fa-chart-line"></i><span>تقدمي</span></button>
</nav>
<div class="sidebar-footer">
<div class="user-info"><i class="fas fa-user-circle"></i><span id="currentUser">المستخدم</span></div>
<button onclick="logout()" class="logout-btn"><i class="fas fa-sign-out-alt"></i> خروج</button>
</div>
</aside>

<main class="main-content">
<header class="top-bar">
<h2 id="pageTitle">مرحباً بك في HealPath</h2>
<div><span id="currentDate"></span></div>
</header>

<section id="home-section" class="content-section active">
<div class="welcome-card">
<div class="welcome-text"><h1>أهلاً <span id="welcomeUser">بك</span>! 👋</h1><p>مسارك نحو التعافي يبدأ من هنا.</p></div>
<div><i class="fas fa-seedling" style="font-size:60px;opacity:0.3"></i></div>
</div>
<div class="stats-grid">
<div class="stat-card"><i class="fas fa-calendar-check"></i><div class="stat-info"><h3 id="daysCount">0</h3><p>يوم من التعافي</p></div></div>
<div class="stat-card"><i class="fas fa-video"></i><div class="stat-info"><h3 id="videosWatched">0</h3><p>جلسة شاهدتها</p></div></div>
<div class="stat-card"><i class="fas fa-fire"></i><div class="stat-info"><h3 id="streakCount">0</h3><p>أيام متتالية</p></div></div>
<div class="stat-card"><i class="fas fa-heart"></i><div class="stat-info"><h3 id="moodToday">جيد</h3><p>مزاج اليوم</p></div></div>
</div>
<div class="quick-actions">
<h3><i class="fas fa-bolt"></i> إجراءات سريعة</h3>
<div class="actions-grid">
<button class="action-card" onclick="showSection('videos')"><i class="fas fa-play-circle"></i><span>شاهد جلسة</span></button>
<button class="action-card" onclick="showSection('progress')"><i class="fas fa-chart-pie"></i><span>تتبع تقدمك</span></button>
<button class="action-card" onclick="logMood()"><i class="fas fa-smile"></i><span>سجل مزاجك</span></button>
<button class="action-card" onclick="showSection('videos')"><i class="fas fa-star"></i><span>جلسات مميزة</span></button>
</div>
</div>
</section>

<section id="videos-section" class="content-section">
<div style="margin-bottom:25px"><h2><i class="fas fa-video"></i> جلسات الفيديو</h2><p style="color:var(--text-light)">جلسات استرخاء وتأمل جاهزة لك</p></div>
<div class="videos-grid" id="videosGrid"></div>
</section>

<section id="progress-section" class="content-section">
<div style="margin-bottom:25px"><h2><i class="fas fa-chart-line"></i> تقدمي</h2></div>
<div class="progress-container">
<div class="progress-card">
<h3>رحلة التعافي</h3>
<div class="progress-ring">
<svg viewBox="0 0 120 120"><circle fill="none" stroke="var(--bg)" stroke-width="8" cx="60" cy="60" r="54"/><circle class="progress-fill" cx="60" cy="60" r="54" id="progressCircle"/></svg>
<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center"><span id="progressPercent" style="font-size:36px;font-weight:800;color:var(--primary)">0%</span><small style="color:var(--text-light);display:block">مكتمل</small></div>
</div>
</div>
<div class="progress-card" style="text-align:right">
<h3><i class="fas fa-flag"></i> معالم التعافي</h3>
<div style="display:flex;flex-direction:column;gap:15px;margin-top:20px">
<div class="milestone completed"><i class="fas fa-check-circle"></i><span>اليوم الأول</span></div>
<div class="milestone"><i class="fas fa-circle" style="color:var(--border)"></i><span>أسبوع كامل</span></div>
<div class="milestone"><i class="fas fa-circle" style="color:var(--border)"></i><span>شهر كامل</span></div>
<div class="milestone"><i class="fas fa-circle" style="color:var(--border)"></i><span>3 أشهر</span></div>
<div class="milestone"><i class="fas fa-circle" style="color:var(--border)"></i><span>6 أشهر</span></div>
<div class="milestone"><i class="fas fa-circle" style="color:var(--border)"></i><span>سنة كاملة</span></div>
</div>
</div>
</div>
</section>
</main>

<script>
const API_URL = '';
let currentUser = null;
let token = localStorage.getItem('healpath_token');

async function checkAuth() {
    if (!token) { window.location.href = '/'; return; }
    try {
        const res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) throw new Error('Unauthorized');
        currentUser = await res.json();
        initDashboard();
    } catch { localStorage.removeItem('healpath_token'); window.location.href = '/'; }
}

function initDashboard() {
    if (!currentUser) return;
    document.getElementById('currentUser').textContent = currentUser.username;
    document.getElementById('welcomeUser').textContent = currentUser.username;
    updateStats();
    loadVideos();
    updateDate();
    updateProgress();
}

function updateStats() {
    if (!currentUser) return;
    document.getElementById('daysCount').textContent = currentUser.daysRecovery || 0;
    document.getElementById('videosWatched').textContent = currentUser.videosWatched || 0;
    document.getElementById('streakCount').textContent = currentUser.streak || 0;
}

function updateDate() {
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(sectionId + '-section').classList.add('active');
    document.querySelectorAll('.nav-item').forEach((item, idx) => {
        const sections = ['home', 'videos', 'progress'];
        if (sections[idx] === sectionId) item.classList.add('active');
    });
    const titles = { home: 'مرحباً بك في HealPath', videos: 'جلسات الفيديو', progress: 'تقدمي' };
    document.getElementById('pageTitle').textContent = titles[sectionId] || 'HealPath';
}

function logout() { localStorage.removeItem('healpath_token'); window.location.href = '/'; }

async function loadVideos() {
    const grid = document.getElementById('videosGrid');
    if (!grid) return;
    try {
        const res = await fetch('/api/videos');
        const videos = await res.json();
        grid.innerHTML = '';
        videos.forEach(video => {
            const div = document.createElement('div');
            div.className = 'video-card';
            div.innerHTML = '<div class="video-thumbnail" onclick="playVideo(\'' + video.id + '\',\'' + video.src + '\')"><i class="fas fa-video"></i><div class="play-btn"><i class="fas fa-play"></i></div></div><div class="video-info"><h4>' + video.title + '</h4><p>' + video.desc + '</p><div class="video-meta"><span><i class="fas fa-clock"></i> ' + video.duration + '</span><span><i class="fas fa-eye"></i> ' + (video.views || 0) + ' مشاهدة</span></div></div>';
            grid.appendChild(div);
        });
    } catch (err) { console.error('Error:', err); }
}

function playVideo(videoId, src) {
    const modal = document.createElement('div');
    modal.className = 'video-modal show';
    modal.innerHTML = '<div class="video-modal-content"><span onclick="closeVideo()" style="position:absolute;top:-50px;left:0;color:white;font-size:35px;cursor:pointer">&times;</span><video controls autoplay><source src="' + src + '" type="video/mp4">متصفحك لا يدعم تشغيل الفيديو</video></div>';
    document.body.appendChild(modal);
    modal.onclick = function(e) { if (e.target === modal) closeVideo(); };
    // تسجيل المشاهدة للمستخدم المسجل
    if (token) {
        fetch('/api/videos/' + videoId + '/watch', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
    }
}

function closeVideo() { const modal = document.querySelector('.video-modal'); if (modal) modal.remove(); }

function updateProgress() {
    if (!currentUser) return;
    const days = currentUser.daysRecovery || 0;
    const progress = Math.min((days / 365) * 100, 100);
    const circle = document.getElementById('progressCircle');
    if (circle) { const c = 2 * Math.PI * 54; circle.style.strokeDashoffset = c - (progress / 100) * c; }
    document.getElementById('progressPercent').textContent = Math.round(progress) + '%';
    const milestones = document.querySelectorAll('.milestone');
    const milestonesDays = [1, 7, 30, 90, 180, 365];
    milestones.forEach((m, i) => { if (days >= milestonesDays[i]) { m.classList.add('completed'); m.querySelector('i').className = 'fas fa-check-circle'; m.querySelector('i').style.color = 'var(--primary)'; } });
}

function logMood() {
    const moods = ['😊 سعيد', '😐 عادي', '😔 حزين', '😰 قلق', '💪 قوي'];
    const mood = prompt('كيف تشعر اليوم؟\n1. سعيد\n2. عادي\n3. حزين\n4. قلق\n5. قوي');
    if (mood && mood >= 1 && mood <= 5) {
        document.getElementById('moodToday').textContent = moods[mood - 1].split(' ')[1];
        showNotification('تم تسجيل مزاجك: ' + moods[mood - 1], 'success');
    }
}

function showNotification(message, type) {
    const notif = document.createElement('div');
    notif.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:15px 30px;border-radius:10px;color:white;font-weight:700;z-index:9999;background:' + (type === 'success' ? '#2D8B5E' : '#EF4444');
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

checkAuth();
</script>
</body>
</html>`;

// ===== الصفحات =====
app.get('/', (req, res) => res.send(LOGIN_PAGE));
app.get('/dashboard', (req, res) => res.send(DASHBOARD_PAGE));

// ===== تشغيل السيرفر =====
app.listen(PORT, () => {
    console.log('🌿 HealPath Server يعمل على البورت ' + PORT);
});
