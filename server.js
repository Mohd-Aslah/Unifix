const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const cors = require('cors'); 
const app = express();
const fs = require('fs');

// Middleware
app.use(cors({
  origin: ['http://localhost:5500', 'http://localhost:5001'],
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection
const uri = "mongodb+srv://mohdaslah1010:Unifix123@cluster0.0vbwp.mongodb.net/admins?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch((err) => console.error('Error connecting to MongoDB Atlas:', err.message));

// MongoDB Schemas
const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
}));

const Violation = mongoose.model('Violation', new mongoose.Schema({
  studentId: { type: String, required: true },
  name: { type: String, required: true },
  uniform_status_image: { type: String, required: true },
  date: { type: Date, default: Date.now },
  face_score:{type:String} 
}));

const Image = mongoose.model('Image', new mongoose.Schema({
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  data: { type: Buffer, required: true },
  collegeName: { type: String, required: true },
  degreeName: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
}));

// JWT Secret Key
const JWT_SECRET = 'your_secret_key';

// Authentication middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// User Registration
app.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch violations
app.get('/violations', authenticate, async (req, res) => {
  try {
    const violations = await Violation.find().sort({ date: -1 });
    res.json(violations);
  } catch (error) {
    console.error('Fetch violations error:', error);
    res.status(500).json({ error: 'Failed to fetch violations' });
  }
});

// Delete violation
app.delete('/violations/:id', authenticate, async (req, res) => {
  try {
    const violation = await Violation.findByIdAndDelete(req.params.id);
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }
    res.json({ message: 'Violation deleted successfully' });
  } catch (error) {
    console.error('Delete violation error:', error);
    res.status(500).json({ error: 'Failed to delete violation' });
  }
});

// Multer configuration for multiple file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload uniform images
app.post('/upload-uniform', authenticate, upload.array('images'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const { collegeName, degreeName } = req.body;
    
    const savedImages = await Promise.all(
      req.files.map(async (file) => {
        const newImage = new Image({
          filename: file.originalname,
          contentType: file.mimetype,
          data: file.buffer,
          collegeName,
          degreeName
        });
        return await newImage.save();
      })
    );

    res.status(200).json({ 
      message: 'Files uploaded successfully',
      images: savedImages.map(img => ({ id: img._id, filename: img.filename }))
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// Download PDF
app.get('/violations/:id/download-pdf', authenticate, async (req, res) => {
  try {
    const violation = await Violation.findById(req.params.id);
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }

    const doc = new PDFDocument();
    const filename = `violation_${violation.studentId || violation._id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Add content to PDF
    doc.fontSize(20).text('Uniform Violation Report', { align: 'center' });
    doc.moveDown(0.5);
    
    const date = new Date(violation.date);
    const formattedDate = `Date: ${date.toLocaleDateString()} Time: ${date.toLocaleTimeString()}`;
    
    doc.fontSize(12)
       .text(`Student ID: ${violation.studentId || 'N/A'}`)
       .text(`Student Name: ${violation.name || 'N/A'}`)
       .text(`Face Score: ${violation.face_score*100}%`)
       .text(formattedDate)
       .text(`Violation: ${violation.complianceStatus || 'Improper Uniform'}`)
       .text('Fine Amount: ₹50')
       .moveDown(1);

    // Add image if available
    if (violation.uniform_status_image) {
      try {
        const imgBuffer = Buffer.from(violation.uniform_status_image, 'base64');
        doc.image(imgBuffer, {
          fit: [150, 100],
          align: 'center',
          valign: 'center'
        });
      } catch (err) {
        doc.text('Image not available', { align: 'center' });
      }
    } else {
      doc.text('No image available', { align: 'center' });
    }

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Server start
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});