const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
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
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');

// لو الملفات ما موجودة، سويها فاضية
[USERS_FILE, CHATS_FILE, TICKETS_FILE, VIDEOS_FILE].forEach(file => {
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

// ===== رفع الفيديوهات =====
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, VIDEOS_DIR),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) cb(null, true);
        else cb(new Error('يرجى رفع فيديو فقط'));
    }
});

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
        supportChats: 0,
        streak: 0,
        lastVisit: null
    };
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    
    // سوي محادثة فارغة للمستخدم
    const chats = readJSON(CHATS_FILE);
    chats.push({ 
        userId: newUser.id, 
        messages: [{ type: 'system', text: '👋 مرحباً! كيف يمكننا مساعدتك اليوم؟', time: new Date().toISOString() }] 
    });
    writeJSON(CHATS_FILE, chats);
    
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
            supportChats: user.supportChats || 0,
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
        supportChats: user.supportChats || 0,
        streak: user.streak || 0
    });
});

// ===== API: المحادثة =====
app.get('/api/chat', authMiddleware, (req, res) => {
    const chats = readJSON(CHATS_FILE);
    const chat = chats.find(c => c.userId === req.user.id);
    res.json(chat ? chat.messages : []);
});

app.post('/api/chat', authMiddleware, (req, res) => {
    const { text } = req.body;
    const chats = readJSON(CHATS_FILE);
    let chat = chats.find(c => c.userId === req.user.id);
    if (!chat) { chat = { userId: req.user.id, messages: [] }; chats.push(chat); }
    
    // رسالة المستخدم
    chat.messages.push({ type: 'sent', text, time: new Date().toISOString() });
    
    // رد تلقائي
    const replies = [
        'شكراً لتواصلك معنا! فريق الدعم سيقوم بالرد عليك قريباً.',
        'نقدر ثقتك بنا. نحن هنا لمساعدتك في أي وقت.',
        'تم استلام رسالتك. سيتواصل معك أحد المختصين قريباً.',
        'نحن معك في كل خطوة. استمر! 💪'
    ];
    chat.messages.push({ 
        type: 'received', 
        text: replies[Math.floor(Math.random() * replies.length)], 
        time: new Date().toISOString() 
    });
    
    writeJSON(CHATS_FILE, chats);
    
    // تحديث عدد المحادثات
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (user) { user.supportChats = (user.supportChats || 0) + 1; writeJSON(USERS_FILE, users); }
    
    res.json({ messages: chat.messages });
});

// ===== API: الدعم الفني =====
app.get('/api/tickets', authMiddleware, (req, res) => {
    res.json(readJSON(TICKETS_FILE).filter(t => t.userId === req.user.id));
});

app.post('/api/tickets', authMiddleware, (req, res) => {
    const { type, subject, details } = req.body;
    const tickets = readJSON(TICKETS_FILE);
    const ticket = {
        id: Date.now().toString(),
        userId: req.user.id,
        type, subject, details,
        status: 'pending',
        date: new Date().toISOString()
    };
    tickets.push(ticket);
    writeJSON(TICKETS_FILE, tickets);
    res.json(ticket);
});

// ===== API: الفيديوهات =====
app.get('/api/videos', (req, res) => res.json(readJSON(VIDEOS_FILE)));

app.post('/api/videos', authMiddleware, upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع الفيديو' });
    
    const videos = readJSON(VIDEOS_FILE);
    const newVideo = {
        id: Date.now().toString(),
        title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ''),
        desc: req.body.desc || 'فيديو مضاف حديثاً',
        filename: req.file.filename,
        src: `/videos/${req.file.filename}`,
        duration: req.body.duration || '00:00',
        views: 0,
        uploadedBy: req.user.id,
        uploadedAt: new Date().toISOString()
    };
    videos.push(newVideo);
    writeJSON(VIDEOS_FILE, videos);
    res.json(newVideo);
});

app.post('/api/videos/:id/watch', authMiddleware, (req, res) => {
    const videos = readJSON(VIDEOS_FILE);
    const video = videos.find(v => v.id === req.params.id);
    if (video) { video.views = (video.views || 0) + 1; writeJSON(VIDEOS_FILE, videos); }
    
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    if (user) { user.videosWatched = (user.videosWatched || 0) + 1; writeJSON(USERS_FILE, users); }
    
    res.json({ success: true });
});

// ===== صفحة تسجيل الدخول (داخل السيرفر) =====
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

// ===== الصفحات =====
app.get('/', (req, res) => res.send(LOGIN_PAGE));

app.get('/dashboard', (req, res) => {
    const dashboardPath = path.join(PUBLIC_DIR, 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        res.status(404).send('dashboard.html not found. Please create public/dashboard.html');
    }
});

// ===== تشغيل السيرفر =====
app.listen(PORT, () => {
    console.log('🌿 HealPath Server يعمل على البورت ' + PORT);
});
