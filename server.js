server_js = r'''const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'healpath-secret-key-2026';

// ===== المسارات =====
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const DATA_DIR = path.join(BASE_DIR, 'data');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');

[DATA_DIR, PUBLIC_DIR, VIDEOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');

function initDataFiles() {
    [USERS_FILE, CHATS_FILE, TICKETS_FILE, VIDEOS_FILE].forEach(file => {
        if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
    });
}
initDataFiles();

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
    
    const chats = readJSON(CHATS_FILE);
    chats.push({ 
        userId: newUser.id, 
        username: newUser.username,
        messages: [{ type: 'system', text: '👋 مرحباً! كيف يمكننا مساعدتك اليوم؟', time: new Date().toISOString() }],
        unread: false
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

// ===== API: المحادثة (العميل) =====
app.get('/api/chat', authMiddleware, (req, res) => {
    const chats = readJSON(CHATS_FILE);
    const chat = chats.find(c => c.userId === req.user.id);
    if (chat) { chat.unread = false; writeJSON(CHATS_FILE, chats); }
    res.json(chat ? chat.messages : []);
});

app.post('/api/chat', authMiddleware, (req, res) => {
    const { text } = req.body;
    const chats = readJSON(CHATS_FILE);
    let chat = chats.find(c => c.userId === req.user.id);
    if (!chat) { 
        chat = { userId: req.user.id, username: req.user.username, messages: [], unread: false }; 
        chats.push(chat); 
    }
    
    chat.messages.push({ type: 'sent', text, time: new Date().toISOString(), fromUser: true });
    chat.unread = true; // ← علامة للأدمن إن فيه رسالة جديدة
    writeJSON(CHATS_FILE, chats);
    
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
        username: req.user.username,
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

// ============================================
// ===== لوحة تحكم الأدمن (أنت) =====
// ============================================

// API: جلب كل المحادثات (للأدمن)
app.get('/api/admin/chats', (req, res) => {
    // في المستقبل: أضف مصادقة للأدمن
    const chats = readJSON(CHATS_FILE);
    res.json(chats.map(c => ({
        userId: c.userId,
        username: c.username,
        lastMessage: c.messages[c.messages.length - 1],
        unread: c.unread,
        messageCount: c.messages.length
    })));
});

// API: جلب محادثة مستخدم محدد (للأدمن)
app.get('/api/admin/chats/:userId', (req, res) => {
    const chats = readJSON(CHATS_FILE);
    const chat = chats.find(c => c.userId === req.params.userId);
    if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });
    
    // تحديث unread
    chat.unread = false;
    writeJSON(CHATS_FILE, chats);
    
    res.json(chat);
});

// API: إرسال رد من الأدمن
app.post('/api/admin/chats/:userId/reply', (req, res) => {
    const { text } = req.body;
    const chats = readJSON(CHATS_FILE);
    const chat = chats.find(c => c.userId === req.params.userId);
    if (!chat) return res.status(404).json({ error: 'المحادثة غير موجودة' });
    
    chat.messages.push({ 
        type: 'received', 
        text, 
        time: new Date().toISOString(),
        fromAdmin: true 
    });
    writeJSON(CHATS_FILE, chats);
    
    res.json({ success: true, messages: chat.messages });
});

// API: جلب كل التذاكر (للأدمن)
app.get('/api/admin/tickets', (req, res) => {
    res.json(readJSON(TICKETS_FILE));
});

// API: تحديث حالة التذكرة
app.post('/api/admin/tickets/:id/status', (req, res) => {
    const { status } = req.body;
    const tickets = readJSON(TICKETS_FILE);
    const ticket = tickets.find(t => t.id === req.params.id);
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });
    
    ticket.status = status;
    writeJSON(TICKETS_FILE, tickets);
    res.json(ticket);
});

// API: إحصائيات
app.get('/api/admin/stats', (req, res) => {
    const users = readJSON(USERS_FILE);
    const chats = readJSON(CHATS_FILE);
    const tickets = readJSON(TICKETS_FILE);
    
    res.json({
        totalUsers: users.length,
        totalChats: chats.length,
        unreadChats: chats.filter(c => c.unread).length,
        totalTickets: tickets.length,
        pendingTickets: tickets.filter(t => t.status === 'pending').length
    });
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
.admin-link{position:fixed;top:20px;left:20px;color:rgba(255,255,255,0.7);text-decoration:none;font-size:14px}
.admin-link:hover{color:white}
</style>
</head>
<body>
<a href="/admin" class="admin-link"><i class="fas fa-cog"></i> لوحة التحكم</a>
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
function showNotification(m,t){const n=document.createElement('div');n.className='notification';n.style.background=t==='success'?'#2D8B5E':'#EF4444';n.textContent=m;document.body.appendChild(n);setTimeout(()=>n.remove(),3000)}
function showRegister(){document.getElementById('registerModal').style.display='flex'}
function closeRegister(){document.getElementById('registerModal').style.display='none'}
document.getElementById('loginForm').addEventListener('submit',async function(e){e.preventDefault();try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value})});const d=await r.json();if(r.ok){localStorage.setItem('healpath_token',d.token);localStorage.setItem('healpath_user',JSON.stringify(d.user));showNotification('تم تسجيل الدخول!','success');setTimeout(()=>window.location.href='/dashboard',500)}else{showNotification(d.error||'خطأ','error')}}catch(err){showNotification('خطأ في الاتصال','error')}});
document.getElementById('registerForm').addEventListener('submit',async function(e){e.preventDefault();const u=document.getElementById('regUsername').value.trim(),p=document.getElementById('regPassword').value;if(u.length<3){showNotification('اسم المستخدم قصير','error');return}if(p.length<4){showNotification('كلمة المرور قصيرة','error');return}try{const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const d=await r.json();if(r.ok){localStorage.setItem('healpath_token',d.token);localStorage.setItem('healpath_user',JSON.stringify(d.user));showNotification('تم إنشاء الحساب!','success');setTimeout(()=>window.location.href='/dashboard',500)}else{showNotification(d.error||'خطأ','error')}}catch(err){showNotification('خطأ في الاتصال','error')}});
</script>
</body>
</html>`;

// ===== صفحة الأدمن =====
const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HealPath - لوحة التحكم</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
:root{--primary:#2D8B5E;--primary-light:#3BA870;--card-bg:#FFFFFF;--bg:#F0F4F0;--text:#1A1A2E;--text-light:#6B7280;--border:#E5E7EB;--shadow:0 4px 20px rgba(0,0,0,0.08)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Tajawal',sans-serif;background:var(--bg);color:var(--text)}
.sidebar{position:fixed;right:0;top:0;width:260px;height:100vh;background:var(--card-bg);box-shadow:var(--shadow);z-index:100;padding:20px}
.sidebar h2{color:var(--primary);margin-bottom:30px;display:flex;align-items:center;gap:10px}
.nav-item{display:flex;align-items:center;gap:12px;padding:14px;border-radius:10px;color:var(--text-light);cursor:pointer;margin-bottom:5px;transition:all 0.3s}
.nav-item:hover,.nav-item.active{background:var(--primary);color:white}
.main-content{margin-right:260px;padding:30px}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-bottom:30px}
.stat-card{background:var(--card-bg);border-radius:16px;padding:25px;box-shadow:var(--shadow);text-align:center}
.stat-card h3{font-size:32px;color:var(--primary);margin-bottom:5px}
.chat-list{background:var(--card-bg);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
.chat-item{padding:20px;border-bottom:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:all 0.3s}
.chat-item:hover{background:var(--bg)}
.chat-item.unread{border-right:4px solid var(--primary)}
.chat-item h4{margin-bottom:5px}
.chat-item p{color:var(--text-light);font-size:14px}
.badge{background:var(--primary);color:white;padding:4px 12px;border-radius:20px;font-size:12px}
.badge.unread{background:#EF4444}
.chat-window{background:var(--card-bg);border-radius:16px;box-shadow:var(--shadow);display:flex;flex-direction:column;height:calc(100vh - 200px)}
.chat-messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px}
.message{max-width:70%;padding:12px 16px;border-radius:18px;font-size:14px}
.message.user{align-self:flex-start;background:var(--primary);color:white}
.message.admin{align-self:flex-end;background:var(--bg);color:var(--text)}
.chat-input{padding:20px;border-top:1px solid var(--border);display:flex;gap:12px}
.chat-input input{flex:1;padding:12px;border:1px solid var(--border);border-radius:25px;font-family:'Tajawal'}
.send-btn{padding:12px 24px;background:var(--primary);color:white;border:none;border-radius:25px;cursor:pointer;font-family:'Tajawal'}
.hidden{display:none!important}
.notification{position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:15px 30px;border-radius:10px;color:white;font-weight:700;z-index:9999}
</style>
</head>
<body>
<div class="sidebar">
<h2><i class="fas fa-leaf"></i> HealPath</h2>
<div class="nav-item active" onclick="showTab('chats')"><i class="fas fa-comments"></i> المحادثات</div>
<div class="nav-item" onclick="showTab('tickets')"><i class="fas fa-ticket-alt"></i> التذاكر</div>
<div class="nav-item" onclick="showTab('stats')"><i class="fas fa-chart-line"></i> الإحصائيات</div>
<div class="nav-item" onclick="window.location.href='/'" style="margin-top:auto"><i class="fas fa-sign-out-alt"></i> خروج</div>
</div>

<div class="main-content">
<div id="chats-tab">
<h2 style="margin-bottom:20px"><i class="fas fa-comments"></i> المحادثات</h2>
<div class="stats-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:20px">
<div class="stat-card"><h3 id="totalChats">0</h3><p>إجمالي المحادثات</p></div>
<div class="stat-card"><h3 id="unreadChats" style="color:#EF4444">0</h3><p>رسائل غير مقروءة</p></div>
</div>
<div class="chat-list" id="chatList"></div>
</div>

<div id="chat-detail" class="hidden">
<button onclick="backToList()" style="margin-bottom:20px;padding:10px 20px;background:var(--primary);color:white;border:none;border-radius:10px;cursor:pointer;font-family:'Tajawal'"><i class="fas fa-arrow-right"></i> رجوع</button>
<h3 id="chatUserName" style="margin-bottom:20px"></h3>
<div class="chat-window">
<div class="chat-messages" id="chatMessages"></div>
<div class="chat-input">
<input type="text" id="replyInput" placeholder="اكتب ردك..." onkeypress="if(event.key==='Enter')sendReply()">
<button class="send-btn" onclick="sendReply()"><i class="fas fa-paper-plane"></i> إرسال</button>
</div>
</div>
</div>

<div id="tickets-tab" class="hidden">
<h2 style="margin-bottom:20px"><i class="fas fa-ticket-alt"></i> التذاكر</h2>
<div id="ticketsList"></div>
</div>

<div id="stats-tab" class="hidden">
<h2 style="margin-bottom:20px"><i class="fas fa-chart-line"></i> الإحصائيات</h2>
<div class="stats-grid">
<div class="stat-card"><h3 id="statUsers">0</h3><p>المستخدمين</p></div>
<div class="stat-card"><h3 id="statChats">0</h3><p>المحادثات</p></div>
<div class="stat-card"><h3 id="statUnread">0</h3><p>غير مقروءة</p></div>
<div class="stat-card"><h3 id="statTickets">0</h3><p>التذاكر</p></div>
</div>
</div>
</div>

<script>
let currentUserId = null;

function showNotification(m,t){const n=document.createElement('div');n.className='notification';n.style.background=t==='success'?'#2D8B5E':'#EF4444';n.textContent=m;document.body.appendChild(n);setTimeout(()=>n.remove(),3000)}

function showTab(tab){
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
event.target.classList.add('active');
document.getElementById('chats-tab').classList.add('hidden');
document.getElementById('tickets-tab').classList.add('hidden');
document.getElementById('stats-tab').classList.add('hidden');
document.getElementById('chat-detail').classList.add('hidden');
document.getElementById(tab+'-tab').classList.remove('hidden');
if(tab==='chats')loadChats();
if(tab==='tickets')loadTickets();
if(tab==='stats')loadStats();
}

async function loadChats(){
try{
const r=await fetch('/api/admin/chats');
const chats=await r.json();
document.getElementById('totalChats').textContent=chats.length;
document.getElementById('unreadChats').textContent=chats.filter(c=>c.unread).length;
let html='';
chats.forEach(chat=>{
const lastMsg=chat.lastMessage?chat.lastMessage.text:'لا توجد رسائل';
const time=chat.lastMessage?new Date(chat.lastMessage.time).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'';
html+='<div class="chat-item '+(chat.unread?'unread':'')+'" onclick="openChat(\''+chat.userId+'\',\''+chat.username+'\')">';
html+='<div><h4>'+chat.username+'</h4><p>'+lastMsg+'</p></div>';
html+='<div style="text-align:left"><span class="badge '+(chat.unread?'unread':'')+'">'+chat.messageCount+'</span><div style="color:var(--text-light);font-size:12px;margin-top:5px">'+time+'</div></div>';
html+='</div>';
});
document.getElementById('chatList').innerHTML=html||'<div style="padding:40px;text-align:center;color:var(--text-light)">لا توجد محادثات</div>';
}catch(e){console.error(e)}
}

async function openChat(userId,username){
currentUserId=userId;
document.getElementById('chats-tab').classList.add('hidden');
document.getElementById('chat-detail').classList.remove('hidden');
document.getElementById('chatUserName').textContent='محادثة: '+username;
loadChatMessages(userId);
}

function backToList(){
document.getElementById('chat-detail').classList.add('hidden');
document.getElementById('chats-tab').classList.remove('hidden');
loadChats();
}

async function loadChatMessages(userId){
try{
const r=await fetch('/api/admin/chats/'+userId);
const chat=await r.json();
const container=document.getElementById('chatMessages');
container.innerHTML='';
chat.messages.forEach(msg=>{
if(msg.type==='system'){
container.innerHTML+='<div style="text-align:center;color:var(--text-light);font-size:13px;padding:10px">'+msg.text+'</div>';
}else{
const isAdmin=msg.fromAdmin;
container.innerHTML+='<div class="message '+(isAdmin?'admin':'user')+'">'+msg.text+'<div style="font-size:10px;opacity:0.7;margin-top:5px">'+new Date(msg.time).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'})+'</div></div>';
}
});
container.scrollTop=container.scrollHeight;
}catch(e){console.error(e)}
}

async function sendReply(){
const input=document.getElementById('replyInput');
const text=input.value.trim();
if(!text||!currentUserId)return;
try{
const r=await fetch('/api/admin/chats/'+currentUserId+'/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
if(r.ok){input.value='';loadChatMessages(currentUserId);showNotification('تم إرسال الرد!','success')}
}catch(e){showNotification('خطأ','error')}
}

async function loadTickets(){
try{
const r=await fetch('/api/admin/tickets');
const tickets=await r.json();
let html='';
if(tickets.length===0){html='<div style="padding:40px;text-align:center;color:var(--text-light)">لا توجد تذاكر</div>'}
else{
tickets.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(t=>{
const typeLabels={technical:'مشكلة تقنية',account:'مشكلة في الحساب',content:'اقتراح محتوى',other:'أخرى'};
html+='<div style="background:var(--card-bg);border-radius:16px;padding:20px;margin-bottom:15px;box-shadow:var(--shadow)">';
html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h4>'+t.subject+'</h4><span style="background:'+(t.status==='pending'?'#FEF3C7':'#D1FAE5')+';color:'+(t.status==='pending'?'#92400E':'#065F46')+';padding:4px 12px;border-radius:20px;font-size:12px">'+(t.status==='pending'?'قيد المعالجة':'تم الحل')+'</span></div>';
html+='<p style="color:var(--text-light);margin-bottom:5px"><strong>العميل:</strong> '+t.username+'</p>';
html+='<p style="color:var(--text-light);margin-bottom:5px"><strong>النوع:</strong> '+typeLabels[t.type]+'</p>';
html+='<p style="margin-bottom:10px">'+t.details+'</p>';
html+='<div style="color:var(--text-light);font-size:13px">'+new Date(t.date).toLocaleString('ar-SA')+'</div>';
if(t.status==='pending'){
html+='<button onclick="resolveTicket(\''+t.id+'\')" style="margin-top:10px;padding:8px 16px;background:var(--primary);color:white;border:none;border-radius:8px;cursor:pointer;font-family:\'Tajawal\'">تم الحل</button>';
}
html+='</div>';
});
}
document.getElementById('ticketsList').innerHTML=html;
}catch(e){console.error(e)}
}

async function resolveTicket(id){
try{
await fetch('/api/admin/tickets/'+id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'resolved'})});
loadTickets();showNotification('تم تحديث الحالة!','success');
}catch(e){showNotification('خطأ','error')}
}

async function loadStats(){
try{
const r=await fetch('/api/admin/stats');
const s=await r.json();
document.getElementById('statUsers').textContent=s.totalUsers;
document.getElementById('statChats').textContent=s.totalChats;
document.getElementById('statUnread').textContent=s.unreadChats;
document.getElementById('statTickets').textContent=s.totalTickets;
}catch(e){console.error(e)}
}

loadChats();
setInterval(()=>{if(!document.getElementById('chats-tab').classList.contains('hidden'))loadChats()},5000);
</script>
</body>
</html>`;

// ===== Routes =====
app.get('/', (req, res) => res.send(LOGIN_PAGE));
app.get('/dashboard', (req, res) => {
    const p = path.join(PUBLIC_DIR, 'dashboard.html');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.status(404).send('dashboard.html not found');
});
app.get('/admin', (req, res) => res.send(ADMIN_PAGE));

// ===== Start =====
app.listen(PORT, () => {
    console.log('🌿 HealPath Server يعمل على البورت ' + PORT);
    console.log('👤 صفحة العميل: http://localhost:' + PORT);
    console.log('🔧 لوحة الأدمن: http://localhost:' + PORT + '/admin');
});
'''

with open(f"{base_dir}/server.js", "w", encoding="utf-8") as f:
    f.write(server_js)

print("✅ server.js معدل مع لوحة أدمن كاملة!")
print()
print("🎯 الجديد:")
print("   - /admin ← لوحة تحكم الأدمن (أنت)")
print("   - تشوف كل المحادثات")
print("   - تقدر ترد على أي عميل")
print("   - تشوف التذاكر وتحدث حالتها")
print("   - إحصائيات كاملة")
print()
print("📍 الروابط:")
print("   العميل: https://healpath-server.onrender.com")
print("   الأدمن: https://healpath-server.onrender.com/admin")
