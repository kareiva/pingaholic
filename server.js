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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Initialize ping service
  console.log('Starting ping service');
  pingService.startMonitoring();
}); 