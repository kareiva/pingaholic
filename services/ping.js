const ping = require('ping');
const cron = require('node-cron');
const db = require('../db/database');

// Ping interval in seconds
const DEFAULT_PING_INTERVAL = 60;
let PING_INTERVAL = DEFAULT_PING_INTERVAL;
let isTurboMode = false;

// Track ping cycle timing
let lastPingTime = null;
let nextPingTime = null;
let pingTask = null;

// Ping a single target
async function pingTarget(target) {
  console.log(`[${new Date().toISOString()}] Pinging ${target.name} (${target.ip})...`);
  
  try {
    const result = await ping.promise.probe(target.ip, {
      timeout: 10,
      extra: ['-c', '1'],
    });
    
    const pingResult = {
      ip: target.ip,
      alive: result.alive,
      time: result.time,
      status: result.alive ? 'green' : 'red'
    };
    
    // Log the result
    console.log(`[${new Date().toISOString()}] Response from ${target.name} (${target.ip}): ${result.alive ? 'alive' : 'unreachable'}, time: ${result.time ? result.time + 'ms' : 'N/A'}`);
    
    // Save result to database
    await db.savePingResult(pingResult);
    
    return pingResult;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error pinging ${target.ip}:`, error);
    return {
      ip: target.ip,
      alive: false,
      time: null,
      status: 'red'
    };
  }
}

// Ping all targets
async function pingAllTargets() {
  try {
    // Record the time of this ping cycle
    lastPingTime = new Date();
    // Calculate next ping time
    nextPingTime = new Date(lastPingTime.getTime() + (PING_INTERVAL * 1000));
    
    let targets = await db.getTargets();
    
    // Extra safety check to ensure targets is an array
    if (!Array.isArray(targets)) {
      console.error(`[${new Date().toISOString()}] Invalid targets data: ${typeof targets}`);
      targets = [];
    }
    
    console.log(`[${new Date().toISOString()}] Starting ping cycle for ${targets.length} targets`);
    
    const results = [];
    
    if (targets.length === 0) {
      console.log(`[${new Date().toISOString()}] No targets configured, skipping ping cycle`);
      return results;
    }
    
    for (const target of targets) {
      const result = await pingTarget(target);
      results.push(result);
    }
    
    console.log(`[${new Date().toISOString()}] Completed ping cycle for ${targets.length} targets`);
    return results;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in pingAllTargets:`, error);
    return [];
  }
}

// Get current ping cycle status
function getPingStatus() {
  const now = new Date();
  
  // Calculate seconds until next ping
  let secondsUntilNextPing = PING_INTERVAL;
  if (nextPingTime) {
    secondsUntilNextPing = Math.max(0, Math.floor((nextPingTime - now) / 1000));
  }
  
  return {
    lastPingTime: lastPingTime ? lastPingTime.toISOString() : null,
    nextPingTime: nextPingTime ? nextPingTime.toISOString() : null,
    secondsUntilNextPing: secondsUntilNextPing,
    pingInterval: PING_INTERVAL,
    turboMode: isTurboMode
  };
}

// Set turbo mode on or off
async function setTurboMode(enabled, interval = 5) {
  if (enabled === isTurboMode) {
    // No change needed if already in the requested state
    return;
  }
  
  isTurboMode = enabled;
  
  // Set the appropriate interval
  PING_INTERVAL = enabled ? interval : DEFAULT_PING_INTERVAL;
  
  console.log(`[${new Date().toISOString()}] ${enabled ? 'Enabling' : 'Disabling'} turbo mode with interval ${PING_INTERVAL}s`);
  
  // Stop the existing cron job
  if (pingTask) {
    pingTask.stop();
  }
  
  // Reset the timing variables before scheduling the new task
  lastPingTime = new Date();
  nextPingTime = new Date(lastPingTime.getTime() + (PING_INTERVAL * 1000));
  
  // Reschedule with the new interval
  pingTask = cron.schedule(`*/${PING_INTERVAL} * * * * *`, () => {
    pingAllTargets().catch(err => {
      console.error(`[${new Date().toISOString()}] Error during scheduled ping:`, err);
    });
  });
  
  // Always run a ping immediately when mode changes (both enabling and disabling)
  try {
    console.log(`[${new Date().toISOString()}] Performing immediate ping after changing to ${enabled ? 'turbo' : 'normal'} mode`);
    await pingAllTargets();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error during immediate ping after mode change:`, err);
  }
}

// Start monitoring
async function startMonitoring() {
  try {
    // Run immediately on startup
    await pingAllTargets();
    
    // Schedule regular pings
    pingTask = cron.schedule(`*/${PING_INTERVAL} * * * * *`, () => {
      pingAllTargets().catch(err => {
        console.error(`[${new Date().toISOString()}] Error during scheduled ping:`, err);
      });
    });
    
    // Set initial next ping time
    if (!nextPingTime) {
      lastPingTime = new Date();
      nextPingTime = new Date(lastPingTime.getTime() + (PING_INTERVAL * 1000));
    }

    console.log(`[${new Date().toISOString()}] Ping monitoring started. Interval: ${PING_INTERVAL}s`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to start monitoring:`, err);
  }
}

module.exports = {
  pingTarget,
  pingAllTargets,
  startMonitoring,
  getPingStatus,
  setTurboMode,
  PING_INTERVAL: DEFAULT_PING_INTERVAL
}; 