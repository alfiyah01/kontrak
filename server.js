const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// MIDDLEWARE (TANPA DEPENDENCY TAMBAHAN)
// =====================

// CORS Configuration - Permissive untuk semua origin
app.use(cors({
    origin: true, // Allow all origins
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy untuk Railway
app.set('trust proxy', 1);

// Simple rate limiting tanpa library external
const requests = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxRequests = 100;
    
    if (!requests.has(ip)) {
        requests.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    const requestData = requests.get(ip);
    if (now > requestData.resetTime) {
        requests.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }
    
    if (requestData.count >= maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    requestData.count++;
    next();
});

// =====================
// DATABASE CONFIG
// =====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://rizalitam10:Yusrizal1993@cluster0.s0e5g5h.mongodb.net/kontrakdb?retryWrites=true&w=majority&appName=Cluster0';
const JWT_SECRET = process.env.JWT_SECRET || 'kontrak_digital_tradestation_secret_key_2024_secure';

// =====================
// SCHEMAS
// =====================

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    role: { type: String, default: 'user', enum: ['user', 'admin'] },
    trading_account: { type: String, trim: true },
    balance: { type: Number, default: 0, min: 0 },
    is_active: { type: Boolean, default: true },
    last_login: { type: Date },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const templateSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    category: { type: String, default: 'general', trim: true },
    content: { type: String, required: true },
    variables: [{ type: String, trim: true }],
    is_active: { type: Boolean, default: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, trim: true }
}, { timestamps: true });

const contractSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    number: { type: String, required: true, unique: true, trim: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
    content: { type: String },
    amount: { type: Number, default: 0, min: 0 },
    status: { 
        type: String, 
        default: 'draft',
        enum: ['draft', 'sent', 'signed', 'completed', 'expired', 'cancelled']
    },
    variables: { type: Object, default: {} },
    signature_data: { type: String },
    signed_at: { type: Date },
    expiry_date: { type: Date },
    admin_notes: { type: String, trim: true },
    access_token: { type: String, unique: true },
    pdf_file_path: { type: String },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sent_at: { type: Date },
    reminder_sent: { type: Number, default: 0 }
}, { timestamps: true });

const contractHistorySchema = new mongoose.Schema({
    contract_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true },
    action: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    performed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip_address: { type: String },
    user_agent: { type: String }
}, { timestamps: true });

// Create Models
const User = mongoose.model('User', userSchema);
const Template = mongoose.model('Template', templateSchema);
const Contract = mongoose.model('Contract', contractSchema);
const ContractHistory = mongoose.model('ContractHistory', contractHistorySchema);

// =====================
// DATABASE CONNECTION
// =====================

async function connectDatabase() {
    try {
        console.log('🔗 Connecting to MongoDB Atlas...');
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        
        console.log('✅ MongoDB Atlas connected successfully!');
        await setupInitialData();
        
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        console.log('⚠️  Continuing with server startup...');
    }
}

async function setupInitialData() {
    try {
        console.log('🚀 Setting up initial data...');
        
        // Create admin user
        const adminExists = await User.findOne({ email: 'admin@tradestation.com' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 12);
            await User.create({
                name: 'Admin TradeStation',
                email: 'admin@tradestation.com',
                username: 'admin',
                password: hashedPassword,
                role: 'admin',
                trading_account: 'ADM001',
                phone: '+62812-3456-7890',
                balance: 0
            });
            console.log('✅ Default admin user created');
        }
        
        // Create sample user
        const userExists = await User.findOne({ email: 'hermanzal@trader.com' });
        if (!userExists) {
            const hashedPassword = await bcrypt.hash('trader123', 12);
            await User.create({
                name: 'Herman Zaldivar',
                email: 'hermanzal@trader.com',
                username: 'hermanzal',
                password: hashedPassword,
                role: 'user',
                trading_account: 'TRD001',
                phone: '+62812-8888-9999',
                balance: 50000000
            });
            console.log('✅ Sample user created');
        }
        
        // Create template
        const templateExists = await Template.findOne({ name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi' });
        if (!templateExists) {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                await Template.create({
                    name: 'Perjanjian Layanan Kerja Sama Konsultasi Investasi',
                    category: 'investment',
                    description: 'Template lengkap untuk perjanjian konsultasi investasi dengan PT. Konsultasi Profesional Indonesia',
                    content: `# Perjanjian Layanan Kerja Sama Konsultasi Investasi

Nomor Kontrak: {{CONTRACT_NUMBER}}

## Pihak A: {{USER_NAME}}

Alamat: {{USER_ADDRESS}}
Email: {{USER_EMAIL}}
Telepon: {{USER_PHONE}}
Trading ID: {{TRADING_ID}}

## Pihak B: PT. Konsultasi Profesional Indonesia

Alamat: Tower 2 Lantai 17 Jl. H. R. Rasuna Said Blok X-5 No.Kav. 2-3,
RT.1/RW.2, Kuningan, Jakarta Selatan 12950

Kontak: Prof. Bima Agung Rachel
Telepon: +62 852 - 5852 - 8771

**Pihak A**, sebagai individu, setuju untuk menggunakan layanan analisis
pasar atau layanan konsultasi yang disediakan oleh **Pihak B**, PT.
Konsultasi Profesional Indonesia. Pihak B menyediakan layanan seperti
analisis pasar, konsultasi investasi, analisis produk, laporan riset
pasar, dsb. Untuk memajukan pembangunan dan kerja sama bersama yang
saling menguntungkan, dan berdasarkan prinsip kesetaraan dan saling
menghormati, kedua belah pihak menyepakati ketentuan-ketentuan berikut
untuk kerja sama ini, dan akan secara ketat mematuhinya.

## Pasal 1: Definisi Awal

1.1. Biaya konsultasi layanan merujuk pada investasi sebesar **{{AMOUNT}}** oleh
pelanggan. Anda dapat meminta Pihak B untuk melakukan analisis data,
laporan, dll.

1.2. Biaya transaksi merujuk pada biaya yang dibebankan oleh Pihak B.
Biaya ini dihitung berdasarkan jumlah transaksi tunggal sebesar **{{TRANSACTION_FEE}}**.

## Pasal 2: Konten Layanan dan Standar Tarif

2.1. Pihak B menyediakan analisis dan rekomendasi kepada Pihak A.

2.2. Pihak A dan B menyetujui metode dan tingkat pembayaran sebesar **{{PAYMENT_METHOD}}**.

2.3. Jika ada biaya tambahan dalam proses kerja sama, harus disetujui
bersama sebelumnya.

2.4. Laporan akhir yang disediakan Pihak B kepada Pihak A mencakup
informasi tentang tren industri, analisis pasar, dan opini profesional
lainnya.

2.5. Informasi yang disediakan oleh Pihak B harus dijaga kerahasiaannya
oleh Pihak A dan tidak boleh disebarkan tanpa izin tertulis.

## Pasal 3: Metode Penyelesaian

3.1. Pihak A akan menyelesaikan pembayaran untuk layanan dan biaya
transaksi sesuai perjanjian dalam waktu **{{PAYMENT_TERMS}}** hari.

3.2. Jika pembayaran tidak dilakukan tepat waktu, Pihak A akan dikenakan
denda harian sebesar **{{LATE_FEE}}**.

3.3. Jika pembayaran tetap tidak dilakukan dalam 30 hari, maka Pihak B
dapat menangguhkan layanan.

3.4. Pihak A bertanggung jawab atas biaya tambahan akibat kegagalan
pembayaran.

3.5. Jika terjadi pembatalan, biaya layanan yang sudah dibayarkan tidak
dapat dikembalikan kecuali jika disepakati lain.

## Pasal 4: Hak dan Kewajiban Pihak A

4.1. Pihak A berhak meminta, mengunduh, dan mengecek data yang diberikan
oleh Pihak B.

4.2. Pihak A harus mengecek dan mencatat data modal secara harian.

4.3. Jika Pihak A tidak puas terhadap layanan, harus disampaikan dalam
waktu 3 hari.

4.4. Pihak A wajib memberikan data dasar transaksi dengan benar kepada
Pihak B.

4.5. Jika ada perubahan musiman atau lainnya, Pihak A dapat meminta
pengakhiran layanan.

4.6. Pihak A menjamin bahwa dana yang digunakan berasal dari sumber yang
sah.

4.7. Pihak A tidak boleh menggunakan informasi layanan ini untuk
tindakan yang melanggar hukum seperti pencucian uang, perjudian,
penghindaran pajak, dll.

## Pasal 5: Hak dan Kewajiban Pihak B

5.1. Pihak B harus menangani permintaan konsultasi dari Pihak A sesuai
perjanjian.

5.2. Pihak B bertanggung jawab memberikan informasi konsultasi pasar
secara akurat.

5.3. Dalam jam kerja normal, Pihak B akan merespons permintaan dari
Pihak A secara wajar.

5.4. Pihak B berhak untuk meningkatkan layanan dan menyesuaikan konten.

5.5. Pihak B dapat menghentikan layanan jika Pihak A tidak membayar atau
bertindak mencurigakan.

5.6. Pihak B tidak boleh menipu atau berkolusi dengan pihak lain.

5.7. Pihak B tidak bertanggung jawab atas risiko operasional dari
keputusan investasi yang dilakukan Pihak A.

5.8. Pihak B dapat menolak transaksi yang melanggar hukum atau
mencurigakan.

5.9. Sengketa diselesaikan melalui negosiasi damai.

5.10. Jika Pihak B tidak dapat memberikan informasi yang akurat, maka
Pihak A dapat mengajukan keluhan.

5.11. Layanan ini tidak boleh melanggar hukum atau peraturan negara
manapun.

5.12. Pihak B berhak mengakhiri perjanjian jika Pihak A tidak
memberitahukan perubahan penting.

5.13. Jika Pihak A melanggar hukum atau menyebabkan kerugian, Pihak B
dapat menuntut ganti rugi.

## Pasal 6: Klausul Kerahasiaan

6.1. Informasi yang diperoleh oleh kedua belah pihak selama masa kerja
sama harus dijaga kerahasiaannya dan tidak boleh disebarkan kepada pihak
ketiga tanpa izin tertulis.

6.2. Kerahasiaan ini meliputi, namun tidak terbatas pada: Informasi
pelanggan, Data operasional, Informasi strategi bisnis, dan Data
investasi.

6.3. Semua informasi tetap milik pihak yang memberikannya dan tidak
dapat digunakan tanpa izin.

6.4. Klausul ini tetap berlaku meskipun perjanjian berakhir.

---

**Tertanda di Jakarta, pada tanggal: {{CONTRACT_DATE}}**

**Perwakilan Pihak B:**
Koh Seng Seng
(PT. Konsultasi Profesional Indonesia)

**Pihak A:**
{{USER_NAME}}
Trading ID: {{TRADING_ID}}

*Tanda tangan digital telah diverifikasi pada {{SIGNED_DATE}}*`,
                    variables: ['USER_NAME', 'USER_EMAIL', 'USER_PHONE', 'USER_ADDRESS', 'TRADING_ID', 'CONTRACT_NUMBER', 'CONTRACT_DATE', 'AMOUNT', 'TRANSACTION_FEE', 'PAYMENT_METHOD', 'PAYMENT_TERMS', 'LATE_FEE', 'SIGNED_DATE'],
                    created_by: admin._id
                });
                console.log('✅ Default template created');
            }
        }
        
        console.log('🎉 Initial data setup completed!');
        
    } catch (error) {
        console.error('❌ Setup initial data error:', error);
    }
}

// =====================
// UTILITY FUNCTIONS
// =====================

function generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateContractNumber() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `TSC${year}${month}${day}${random}`;
}

// PDF Generation
async function generateContractPDF(contract, user, signatureData) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ 
                margin: 50,
                info: {
                    Title: `Kontrak ${contract.number}`,
                    Author: 'TradeStation Kontrak Digital',
                    Subject: contract.title,
                    Creator: 'TradeStation System'
                }
            });
            
            let buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });
            doc.on('error', reject);

            // Header
            doc.fontSize(18).font('Helvetica-Bold').text('KONTRAK DIGITAL TRADESTATION', { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(12).font('Helvetica').text(`Nomor Kontrak: ${contract.number}`, { align: 'center' });
            doc.fontSize(10).text(`Dibuat pada: ${new Date(contract.createdAt).toLocaleDateString('id-ID')}`, { align: 'center' });
            doc.moveDown(1);

            // Content
            let content = contract.content || '';
            
            // Replace variables
            content = content.replace(/\{\{USER_NAME\}\}/g, user.name);
            content = content.replace(/\{\{USER_EMAIL\}\}/g, user.email || '');
            content = content.replace(/\{\{USER_PHONE\}\}/g, user.phone || '');
            content = content.replace(/\{\{TRADING_ID\}\}/g, user.trading_account || '');
            content = content.replace(/\{\{CONTRACT_NUMBER\}\}/g, contract.number);
            content = content.replace(/\{\{CONTRACT_DATE\}\}/g, new Date(contract.createdAt).toLocaleDateString('id-ID'));
            content = content.replace(/\{\{AMOUNT\}\}/g, new Intl.NumberFormat('id-ID', {
                style: 'currency',
                currency: 'IDR',
                minimumFractionDigits: 0
            }).format(contract.amount));

            // Replace custom variables
            Object.keys(contract.variables || {}).forEach(key => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                content = content.replace(regex, contract.variables[key] || '');
            });

            // Process content
            const lines = content.split('\n');
            
            lines.forEach(line => {
                line = line.trim();
                if (line) {
                    if (line.startsWith('# ')) {
                        doc.fontSize(14).font('Helvetica-Bold').text(line.substring(2), { align: 'center' });
                        doc.moveDown(0.5);
                    } else if (line.startsWith('## ')) {
                        doc.fontSize(12).font('Helvetica-Bold').text(line.substring(3));
                        doc.moveDown(0.3);
                    } else {
                        const processedLine = line.replace(/\*\*(.*?)\*\*/g, '$1');
                        doc.fontSize(10).font('Helvetica').text(processedLine, { 
                            align: 'justify',
                            lineGap: 2
                        });
                        doc.moveDown(0.2);
                    }
                    
                    if (doc.y > 720) {
                        doc.addPage();
                    }
                }
            });

            // Signature section
            doc.moveDown(2);
            doc.fontSize(12).font('Helvetica-Bold').text('TANDA TANGAN DIGITAL', { align: 'center' });
            doc.moveDown(0.5);
            
            if (signatureData && contract.signed_at) {
                doc.fontSize(10).font('Helvetica-Bold').text('✓ KONTRAK TELAH DITANDATANGANI SECARA DIGITAL', { align: 'center' });
                doc.moveDown(0.3);
                doc.font('Helvetica').text(`Ditandatangani oleh: ${user.name}`, { align: 'center' });
                doc.text(`Trading ID: ${user.trading_account}`, { align: 'center' });
                doc.text(`Tanggal: ${new Date(contract.signed_at).toLocaleString('id-ID')}`, { align: 'center' });
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// =====================
// MIDDLEWARE AUTH
// =====================

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).where('is_active').equals(true);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid token or user not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
};

const authenticateAdmin = async (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// =====================
// ROUTES
// =====================

// Health Check
app.get('/api/health', async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected',
            environment: process.env.NODE_ENV || 'development',
            mongodb: 'MongoDB Atlas',
            uptime: process.uptime(),
            version: '1.0.0'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error.message
        });
    }
});

// Auth Routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = await User.findOne({
            $or: [
                { email: email.toLowerCase() }, 
                { username: email.toLowerCase() }
            ],
            is_active: true
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        await User.findByIdAndUpdate(user._id, { last_login: new Date() });

        const token = jwt.sign(
            { 
                userId: user._id, 
                email: user.email, 
                role: user.role,
                iat: Math.floor(Date.now() / 1000)
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const userResponse = user.toObject();
        delete userResponse.password;

        res.json({
            message: 'Login successful',
            token,
            user: {
                ...userResponse,
                tradingAccount: user.trading_account
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const userResponse = req.user.toObject();
        delete userResponse.password;
        
        res.json({
            user: {
                ...userResponse,
                tradingAccount: req.user.trading_account
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// Contract Access Routes
app.get('/api/contracts/access/:token', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || token.length < 32) {
            return res.status(400).json({ error: 'Invalid access token' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account is_active')
            .populate('template_id', 'name content variables');

        if (!contract || !contract.user_id || !contract.user_id.is_active) {
            return res.status(404).json({ error: 'Contract not found or access denied' });
        }

        if (contract.expiry_date && new Date() > contract.expiry_date) {
            await Contract.findByIdAndUpdate(contract._id, { status: 'expired' });
            return res.status(410).json({ error: 'Contract has expired' });
        }

        let content = contract.template_id?.content || contract.content || '';
        const variables = contract.variables || {};
        
        // Replace variables
        content = content.replace(/\{\{USER_NAME\}\}/g, contract.user_id.name);
        content = content.replace(/\{\{USER_EMAIL\}\}/g, contract.user_id.email || '');
        content = content.replace(/\{\{USER_PHONE\}\}/g, contract.user_id.phone || '');
        content = content.replace(/\{\{TRADING_ID\}\}/g, contract.user_id.trading_account || '');
        content = content.replace(/\{\{CONTRACT_NUMBER\}\}/g, contract.number);
        content = content.replace(/\{\{CONTRACT_DATE\}\}/g, new Date(contract.createdAt).toLocaleDateString('id-ID'));
        content = content.replace(/\{\{AMOUNT\}\}/g, new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(contract.amount));

        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            content = content.replace(regex, variables[key] || '');
        });

        res.json({
            data: {
                ...contract.toObject(),
                content,
                user: {
                    name: contract.user_id.name,
                    email: contract.user_id.email,
                    phone: contract.user_id.phone,
                    trading_account: contract.user_id.trading_account
                },
                template: contract.template_id ? {
                    name: contract.template_id.name,
                    variables: contract.template_id.variables
                } : null
            }
        });
    } catch (error) {
        console.error('Contract access error:', error);
        res.status(500).json({ error: 'Failed to access contract' });
    }
});

app.post('/api/contracts/access/:token/sign', async (req, res) => {
    try {
        const { token } = req.params;
        const { signatureData, variables } = req.body;

        if (!signatureData) {
            return res.status(400).json({ error: 'Signature data required' });
        }

        if (!signatureData.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Invalid signature format' });
        }

        const contract = await Contract.findOne({ access_token: token })
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status === 'signed' || contract.status === 'completed') {
            return res.status(400).json({ error: 'Contract already signed' });
        }

        if (contract.status !== 'sent') {
            return res.status(400).json({ error: 'Contract is not ready for signing' });
        }

        const finalVariables = variables ? { ...contract.variables, ...variables } : contract.variables;
        const updatedContract = { ...contract.toObject(), variables: finalVariables };
        
        // Generate PDF
        await generateContractPDF(updatedContract, contract.user_id, signatureData);

        await Contract.findByIdAndUpdate(contract._id, {
            status: 'signed',
            signature_data: signatureData,
            signed_at: new Date(),
            variables: finalVariables
        });

        await ContractHistory.create({
            contract_id: contract._id,
            action: 'signed',
            description: 'Contract signed by user with digital signature',
            performed_by: contract.user_id._id,
            ip_address: req.ip,
            user_agent: req.get('User-Agent')
        });

        res.json({ 
            message: 'Contract signed successfully',
            pdfDownloadUrl: `/api/contracts/download/${contract._id}`,
            signedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Contract signing error:', error);
        res.status(500).json({ error: 'Failed to sign contract' });
    }
});

app.get('/api/contracts/download/:contractId', async (req, res) => {
    try {
        const { contractId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(contractId)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(contractId)
            .populate('user_id', 'name email phone trading_account');

        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status !== 'signed' && contract.status !== 'completed') {
            return res.status(400).json({ error: 'Contract is not signed yet' });
        }

        const pdfBuffer = await generateContractPDF(contract, contract.user_id, contract.signature_data);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Kontrak_${contract.number}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Download contract error:', error);
        res.status(500).json({ error: 'Failed to download contract' });
    }
});

// Admin Routes
app.get('/api/contracts', authenticateToken, async (req, res) => {
    try {
        let query = {};
        if (req.user.role !== 'admin') {
            query.user_id = req.user._id;
        }

        const contracts = await Contract.find(query)
            .populate('user_id', 'name email phone trading_account')
            .populate('template_id', 'name')
            .sort({ createdAt: -1 })
            .limit(100);
        
        const formattedContracts = contracts.map(contract => ({
            ...contract.toObject(),
            user_name: contract.user_id?.name,
            user_email: contract.user_id?.email,
            trading_account: contract.user_id?.trading_account,
            template_name: contract.template_id?.name
        }));
        
        res.json({ data: formattedContracts });
    } catch (error) {
        console.error('Get contracts error:', error);
        res.status(500).json({ error: 'Failed to get contracts' });
    }
});

app.post('/api/contracts', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { title, templateId, userId, amount, variables, sendImmediately } = req.body;

        if (!title || !templateId || !userId || amount === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const contractNumber = generateContractNumber();
        const accessToken = generateAccessToken();
        const status = sendImmediately ? 'sent' : 'draft';

        const contract = await Contract.create({
            title: title.trim(),
            number: contractNumber,
            user_id: userId,
            template_id: templateId,
            amount: parseFloat(amount),
            status,
            variables: variables || {},
            access_token: accessToken,
            created_by: req.user._id,
            sent_at: sendImmediately ? new Date() : null
        });

        res.json({
            message: 'Contract created successfully',
            data: contract,
            accessLink: `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${accessToken}`
        });
    } catch (error) {
        console.error('Create contract error:', error);
        res.status(500).json({ error: 'Failed to create contract' });
    }
});

app.post('/api/contracts/:id/generate-link', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid contract ID' });
        }

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ error: 'Contract not found' });
        }

        if (contract.status === 'draft') {
            await Contract.findByIdAndUpdate(id, { 
                status: 'sent',
                sent_at: new Date()
            });
        }

        const accessLink = `${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}/?token=${contract.access_token}`;
        
        res.json({
            message: 'Contract link generated successfully',
            accessLink,
            token: contract.access_token
        });
    } catch (error) {
        console.error('Generate link error:', error);
        res.status(500).json({ error: 'Failed to generate link' });
    }
});

app.get('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const templates = await Template.find({ is_active: true })
            .populate('created_by', 'name')
            .sort({ createdAt: -1 });
            
        const formattedTemplates = templates.map(template => ({
            ...template.toObject(),
            id: template._id.toString(),
            created_by_name: template.created_by?.name
        }));
        
        res.json({ data: formattedTemplates });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ error: 'Failed to get templates' });
    }
});

app.post('/api/templates', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, category, content, description } = req.body;
        
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content required' });
        }
        
        const variableMatches = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
        const variables = [...new Set(variableMatches.map(match => match.replace(/[{}]/g, '')))];
        
        const template = await Template.create({
            name: name.trim(),
            category: (category || 'general').trim(),
            content: content.trim(),
            description: description?.trim(),
            variables,
            created_by: req.user._id
        });
        
        const templateResponse = template.toObject();
        templateResponse.id = templateResponse._id.toString();
        
        res.json({
            message: 'Template created successfully',
            data: templateResponse
        });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

app.get('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const users = await User.find({ is_active: true })
            .select('-password')
            .sort({ createdAt: -1 });
        
        res.json({ data: users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

app.post('/api/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { name, email, phone, tradingAccount } = req.body;

        if (!name || !email || !phone) {
            return res.status(400).json({ error: 'Name, email, and phone are required' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const defaultPassword = 'trader123';
        const hashedPassword = await bcrypt.hash(defaultPassword, 12);
        const finalTradingAccount = tradingAccount || `TRD${Date.now().toString().slice(-6)}`;

        const user = await User.create({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            phone: phone.trim(),
            password: hashedPassword,
            role: 'user',
            trading_account: finalTradingAccount,
            balance: 0,
            created_by: req.user._id
        });

        const userResponse = user.toObject();
        delete userResponse.password;
        userResponse.id = userResponse._id.toString();

        res.json({
            message: 'User created successfully',
            data: userResponse,
            defaultPassword
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

app.get('/api/stats/dashboard', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const [totalContracts, pendingSignatures, completedContracts, totalValueResult] = await Promise.all([
                Contract.countDocuments(),
                Contract.countDocuments({ status: 'sent' }),
                Contract.countDocuments({ status: { $in: ['signed', 'completed'] } }),
                Contract.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
            ]);

            res.json({
                data: {
                    totalContracts,
                    pendingSignatures,
                    completedContracts,
                    totalValue: totalValueResult[0]?.total || 0
                }
            });
        } else {
            const [totalContracts, pendingSignatures, completedContracts] = await Promise.all([
                Contract.countDocuments({ user_id: req.user._id }),
                Contract.countDocuments({ user_id: req.user._id, status: 'sent' }),
                Contract.countDocuments({ user_id: req.user._id, status: { $in: ['signed', 'completed'] } })
            ]);

            res.json({
                data: { totalContracts, pendingSignatures, completedContracts, totalValue: 0 }
            });
        }
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to get dashboard stats' });
    }
});

// Error handling
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
});

// Start server
async function startServer() {
    try {
        await connectDatabase();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 TradeStation Kontrak Digital Server running on port ${PORT}`);
            console.log(`📱 Frontend: ${process.env.FRONTEND_URL || 'https://kontrakdigital.com'}`);
            console.log(`🔗 API Health: https://kontrak-production.up.railway.app/api/health`);
            console.log(`💾 Database: MongoDB Atlas`);
            console.log(`🎯 Ready to handle requests!`);
            console.log(`✅ NO EXTERNAL DEPENDENCIES - Clean & Stable`);
        });

        server.on('error', (error) => {
            console.error('Server error:', error);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT} (DB connection failed)`);
        });
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');  
    process.exit(0);
});

startServer();
