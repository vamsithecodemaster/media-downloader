import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import downloadRoutes from './routes/download.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

// API Routes
app.use('/api', downloadRoutes);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../client/dist')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Any other route should serve the frontend application
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     Media Downloader Server          ║');
  console.log(`  ║     Running on port ${PORT}             ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  → API: http://localhost:${PORT}/api`);
  console.log(`  → Health: http://localhost:${PORT}/health`);
  console.log('');
});
