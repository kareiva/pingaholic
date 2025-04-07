const express = require('express');
const router = express.Router();
const db = require('../db/database');
const pingService = require('../services/ping');
const discoveryService = require('../services/discovery');
const ip = require('ip');
const ping = require('ping');
const path = require('path');
const fs = require('fs');

// Add a global variable to track discovery state on the server
let isDiscoveryRunning = false;

// Get all targets
router.get('/targets', (req, res) => {
  const targets = db.getTargets();
  res.json(targets);
});

// Add a new target
router.post('/targets', (req, res) => {
  const { ip, name } = req.body;
  
  if (!ip) {
    console.log(`[${new Date().toISOString()}] Target creation rejected: missing IP address`);
    return res.status(400).json({ error: 'IP address is required' });
  }
  
  try {
    // Check if a target with this IP already exists
    const existingTargets = db.getTargets();
    const existingTarget = existingTargets.find(target => target.ip === ip);
    
    if (existingTarget) {
      console.log(`[${new Date().toISOString()}] Target creation rejected: IP ${ip} already exists`);
      return res.status(409).json({ error: 'A target with this IP address already exists' });
    }
    
    const target = {
      ip,
      name: name || `Host-${ip.split('.').pop()}`,
      added: Date.now()
    };
    
    console.log(`[${new Date().toISOString()}] Adding new target: ${target.name} (${target.ip})`);
    db.addTarget(target);
    console.log(`[${new Date().toISOString()}] Target added successfully`);
    
    res.status(201).json(target);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error adding target:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove a target
router.delete('/targets/:ip', (req, res) => {
  const { ip } = req.params;
  console.log(`[${new Date().toISOString()}] Removing target with IP: ${ip}`);
  db.removeTarget(ip);
  res.status(204).send();
});

// Get ping results for a target
router.get('/results/:ip', (req, res) => {
  const { ip } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  
  const results = db.getPingResults(ip, limit);
  res.json(results);
});

// Ping all targets now
router.post('/ping', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Manual ping request received`);
  const results = await pingService.pingAllTargets();
  
  // Get the timing information
  const pingStatus = pingService.getPingStatus();
  
  console.log(`[${new Date().toISOString()}] Manual ping completed with ${results.length} results`);
  
  // Return both the results and timing information
  res.json({
    results: results,
    pingStatus: pingStatus
  });
});

// Discover hosts in a network range with progress updates
router.post('/discover', async (req, res) => {
  const { networkRange } = req.body;
  
  if (!networkRange) {
    console.log(`[${new Date().toISOString()}] Discovery request rejected: missing network range`);
    return res.status(400).json({ error: 'Network range is required' });
  }
  
  // Check if discovery is already running
  if (isDiscoveryRunning) {
    console.log(`[${new Date().toISOString()}] Discovery request rejected: another discovery is already in progress`);
    return res.status(409).json({ error: 'Another discovery is already in progress' });
  }
  
  // Set discovery state to running
  isDiscoveryRunning = true;
  
  console.log(`[${new Date().toISOString()}] Discovery request received for network range: ${networkRange}`);
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    // Parse network range
    const network = ip.cidrSubnet(networkRange);
    const firstIp = ip.toLong(network.firstAddress);
    const lastIp = ip.toLong(network.lastAddress);
    const totalHosts = lastIp - firstIp + 1 - 2; // +1 for inclusive range, -2 for network and broadcast addresses
    
    console.log(`[${new Date().toISOString()}] Scanning IP range from ${network.firstAddress} to ${network.lastAddress}`);
    
    const discoveredHosts = [];
    let scannedCount = 0;
    
    // Send initial progress
    res.write(JSON.stringify({
      type: 'progress',
      total: totalHosts,
      scanned: 0,
      found: 0
    }));
    
    // Ping each IP in the range
    for (let i = firstIp; i <= lastIp; i++) {
      const currentIp = ip.fromLong(i);
      
      // Skip network and broadcast addresses
      if (currentIp === network.networkAddress || currentIp === network.broadcastAddress) {
        continue;
      }
      
      scannedCount++;
      console.log(`[${new Date().toISOString()}] Scanning IP: ${currentIp} (${scannedCount}/${totalHosts})`);
      
      const result = await ping.promise.probe(currentIp, {
        timeout: 0.1, // Ensure this is 100ms
        extra: ['-c', '1'],
      });
      
      // Send progress update
      res.write(JSON.stringify({
        type: 'progress',
        total: totalHosts,
        scanned: Math.min(scannedCount, totalHosts),
        found: discoveredHosts.length,
        currentIp: currentIp,
        percent: Math.min(Math.round((scannedCount / totalHosts) * 100), 100)
      }));
      
      if (result.alive) {
        const host = {
          ip: currentIp,
          name: `Host-${currentIp.split('.').pop()}`,
          alive: true,
          time: result.time,
          added: Date.now()
        };
        
        // Check if this host already exists in the targets
        const existingTargets = db.getTargets();
        const existingTarget = existingTargets.find(target => target.ip === currentIp);
        
        let addedToTargets = false;
        
        // Only add if it doesn't already exist
        if (!existingTarget) {
          db.addTarget(host);
          addedToTargets = true;
          console.log(`[${new Date().toISOString()}] Host found: ${currentIp}, response time: ${result.time}ms, added to targets`);
        } else {
          console.log(`[${new Date().toISOString()}] Host found: ${currentIp}, response time: ${result.time}ms, already exists in targets`);
        }
        
        discoveredHosts.push(host);
        
        // Send host found update
        res.write(JSON.stringify({
          type: 'host',
          host: host,
          addedToTargets: addedToTargets,
          alreadyExists: !!existingTarget
        }));
      }
    }
    
    // Send completion message
    console.log(`[${new Date().toISOString()}] Network discovery completed. Scanned ${scannedCount} hosts, found ${discoveredHosts.length} alive hosts.`);
    res.write(JSON.stringify({
      type: 'complete',
      hosts: discoveredHosts
    }));
    
    res.end();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error discovering hosts:`, error);
    res.write(JSON.stringify({
      type: 'error',
      message: error.message
    }));
    res.end();
  } finally {
    // Reset discovery state regardless of success or failure
    isDiscoveryRunning = false;
  }
});

// Update the debug endpoint
router.get('/debug/database', (req, res) => {
  try {
    // Get direct debug info
    const debugInfo = db.debug();
    
    // Get current targets using the normal method
    const targets = db.getTargets();
    
    res.json({
      fileInfo: debugInfo,
      targets,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// Add a route to reset a target's ping data
router.post('/targets/:ip/reset', (req, res) => {
  const { ip } = req.params;
  
  try {
    console.log(`[${new Date().toISOString()}] Resetting ping data for target: ${ip}`);
    
    // Check if target exists
    const targets = db.getTargets();
    const targetExists = targets.some(target => target.ip === ip);
    
    if (!targetExists) {
      console.log(`[${new Date().toISOString()}] Reset failed: Target ${ip} not found`);
      return res.status(404).json({ error: 'Target not found' });
    }
    
    // Clear ping results for the target
    db.clearPingResults(ip);
    
    console.log(`[${new Date().toISOString()}] Successfully reset ping data for ${ip}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error resetting ping data for ${ip}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a route to reset the database
router.post('/debug/reset-database', (req, res) => {
  try {
    console.log('[DATABASE] Resetting database...');
    const result = db.resetDatabase();
    console.log('[DATABASE] Database reset completed');
    
    res.json({
      success: true,
      message: 'Database has been reset and rebuilt',
      targets: result.targets.length
    });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get ping cycle status (for UI timer sync)
router.get('/ping/status', (req, res) => {
  try {
    const pingStatus = pingService.getPingStatus();
    res.json(pingStatus);
  } catch (error) {
    console.error('Error getting ping status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 