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
// Track turbo mode state
let turboModeEnabled = false;
// Default ping interval is 60 seconds, turbo mode is 5 seconds
const TURBO_MODE_INTERVAL = 5;

// Function to generate a Docker-style random host name with drinking-related adjectives
function generateDrunkenHostName() {
  const drinkingAdjectives = [
    'tipsy', 'buzzed', 'wobbly', 'woozy', 'dizzy', 'sloshed', 'boozy',
    'malty', 'foamy', 'spirited', 'bubbly', 'fermented', 'distilled',
    'pickled', 'hoppy', 'frothy', 'intoxicated', 'groggy', 'staggering',
    'tequila', 'whiskey', 'bourbon', 'scotch', 'vodka', 'drunken',
    'brewed', 'merry', 'jolly', 'barley', 'potent', 'spiked'
  ];
  
  const randomNouns = [
    'penguin', 'octopus', 'falcon', 'walrus', 'koala', 'badger', 'otter',
    'tiger', 'panda', 'jaguar', 'elephant', 'wombat', 'platypus', 'meerkat',
    'gorilla', 'dolphin', 'raccoon', 'narwhal', 'salmon', 'buffalo', 'mongoose',
    'ferret', 'squirrel', 'lobster', 'hedgehog', 'beaver', 'armadillo',
    'gecko', 'iguana', 'pelican', 'ostrich', 'flamingo', 'hippo', 'turtle'
  ];
  
  const randomAdjective = drinkingAdjectives[Math.floor(Math.random() * drinkingAdjectives.length)];
  const randomNoun = randomNouns[Math.floor(Math.random() * randomNouns.length)];
  
  return `${randomAdjective}_${randomNoun}`;
}

// Get all targets
router.get('/targets', async (req, res) => {
  try {
    const targets = await db.getTargets();
    res.json(targets);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting targets:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a new target
router.post('/targets', async (req, res) => {
  const { ip: ipAddress, name } = req.body;
  
  if (!ipAddress) {
    console.log(`[${new Date().toISOString()}] Target creation rejected: missing IP address`);
    return res.status(400).json({ error: 'IP address is required' });
  }
  
  try {
    // Check if a target with this IP already exists
    const targets = await db.getTargets();
    const existingTarget = targets.find(target => target.ip === ipAddress);
    
    if (existingTarget) {
      console.log(`[${new Date().toISOString()}] Target creation rejected: IP ${ipAddress} already exists`);
      return res.status(409).json({ error: 'A target with this IP address already exists' });
    }
    
    const target = {
      ip: ipAddress,
      name: name || generateDrunkenHostName(),
      added: Date.now()
    };
    
    console.log(`[${new Date().toISOString()}] Adding new target: ${target.name} (${target.ip})`);
    const newTarget = await db.addTarget(target);
    console.log(`[${new Date().toISOString()}] Target added successfully`);
    
    res.status(201).json(newTarget);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error adding target:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove a target
router.delete('/targets/:ip', async (req, res) => {
  const { ip: ipAddress } = req.params;
  
  try {
    console.log(`[${new Date().toISOString()}] Removing target with IP: ${ipAddress}`);
    await db.removeTarget(ipAddress);
    res.status(204).send();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error removing target:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get ping results for a target
router.get('/results/:ip', async (req, res) => {
  const { ip: ipAddress } = req.params;
  const limit = parseInt(req.query.limit) || 100;
  
  try {
    const results = await db.getPingResults(ipAddress, limit);
    res.json(results);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting ping results:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ping all targets now
router.post('/ping', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Manual ping request received`);
  
  try {
    const results = await pingService.pingAllTargets();
    
    // Get the timing information
    const pingStatus = pingService.getPingStatus();
    
    console.log(`[${new Date().toISOString()}] Manual ping completed with ${results.length} results`);
    
    // Return both the results and timing information
    res.json({
      results: results,
      pingStatus: pingStatus
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in manual ping:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
          name: generateDrunkenHostName(),
          alive: true,
          time: result.time,
          added: Date.now()
        };
        
        // Check if this host already exists in the targets
        const targets = await db.getTargets();
        const existingTarget = targets.find(target => target.ip === currentIp);
        
        let addedToTargets = false;
        
        // Only add if it doesn't already exist
        if (!existingTarget) {
          await db.addTarget(host);
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
router.get('/debug/database', async (req, res) => {
  try {
    // Get direct debug info
    const debugInfo = await db.debug();
    
    // Get current targets using the normal method
    const targets = await db.getTargets();
    
    res.json({
      dbInfo: debugInfo,
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
router.post('/targets/:ip/reset', async (req, res) => {
  const { ip: ipAddress } = req.params;
  
  try {
    console.log(`[${new Date().toISOString()}] Resetting ping data for target: ${ipAddress}`);
    
    // Check if target exists
    const targets = await db.getTargets();
    const targetExists = targets.some(target => target.ip === ipAddress);
    
    if (!targetExists) {
      console.log(`[${new Date().toISOString()}] Reset failed: Target ${ipAddress} not found`);
      return res.status(404).json({ error: 'Target not found' });
    }
    
    // Clear ping results for the target
    await db.clearPingResults(ipAddress);
    
    console.log(`[${new Date().toISOString()}] Successfully reset ping data for ${ipAddress}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error resetting ping data for ${ipAddress}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a route to reset the database
router.post('/debug/reset-database', async (req, res) => {
  try {
    console.log('[DATABASE] Resetting database...');
    await db.resetDatabase();
    console.log('[DATABASE] Database reset completed');
    
    // Get updated target count
    const targets = await db.getTargets();
    
    res.json({
      success: true,
      message: 'Database has been reset and rebuilt',
      targets: targets.length
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
    // Add turbo mode status to the response
    pingStatus.turboMode = turboModeEnabled;
    res.json(pingStatus);
  } catch (error) {
    console.error('Error getting ping status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle turbo mode
router.post('/ping/turbo', async (req, res) => {
  try {
    // Get the requested state from the body
    const { enabled } = req.body;
    
    // Only update if the state is changing
    if (turboModeEnabled !== enabled) {
      console.log(`[${new Date().toISOString()}] ${enabled ? 'Enabling' : 'Disabling'} turbo mode`);
      turboModeEnabled = enabled;
      
      // Update the ping service interval
      if (turboModeEnabled) {
        await pingService.setTurboMode(true, TURBO_MODE_INTERVAL);
      } else {
        await pingService.setTurboMode(false);
      }
    }
    
    // Get the updated ping status
    const pingStatus = pingService.getPingStatus();
    
    res.json({
      success: true,
      turboMode: turboModeEnabled,
      pingStatus: pingStatus
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error toggling turbo mode:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 