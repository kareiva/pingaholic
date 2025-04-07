const express = require('express');
const path = require('path');
const db = require('./db/database');
const pingService = require('./services/ping');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);

// Start the server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  try {
    // First ensure database is ready by querying it
    await db.getTargets();
    
    // Initialize ping service once database is ready
    console.log('Database initialized, starting ping service');
    pingService.startMonitoring();
  } catch (err) {
    console.error('Failed to initialize database or start ping service:', err);
  }
}); 