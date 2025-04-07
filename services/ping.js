const ping = require('ping');
const cron = require('node-cron');
const db = require('../db/database');

// Ping interval in seconds
const PING_INTERVAL = 60;

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
      name: target.name,
      alive: result.alive,
      time: result.time,
      status: result.alive ? 'green' : 'red'
    };
    
    // Log the result
    console.log(`[${new Date().toISOString()}] Response from ${target.name} (${target.ip}): ${result.alive ? 'alive' : 'unreachable'}, time: ${result.time ? result.time + 'ms' : 'N/A'}`);
    
    // Save result to database
    db.savePingResult(pingResult);
    
    return pingResult;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error pinging ${target.ip}:`, error);
    return {
      ip: target.ip,
      name: target.name,
      alive: false,
      time: null,
      status: 'red'
    };
  }
}

// Ping all targets
async function pingAllTargets() {
  try {
    let targets = db.getTargets();
    
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

// Start monitoring
function startMonitoring() {
  // Run immediately on startup
  pingAllTargets();
  
  // Schedule regular pings
  cron.schedule(`*/${PING_INTERVAL} * * * * *`, () => {
    pingAllTargets();
  });
}

module.exports = {
  pingTarget,
  pingAllTargets,
  startMonitoring
}; 