const ping = require('ping');
const ip = require('ip');
const db = require('../db/database');

// Discover hosts in a network range
async function discoverHosts(networkRange) {
  console.log(`[${new Date().toISOString()}] Starting network discovery for range: ${networkRange}`);
  
  try {
    // Parse network range (e.g., "192.168.1.0/24")
    const network = ip.cidrSubnet(networkRange);
    const firstIp = ip.toLong(network.firstAddress);
    const lastIp = ip.toLong(network.lastAddress);
    
    console.log(`[${new Date().toISOString()}] Scanning IP range from ${network.firstAddress} to ${network.lastAddress}`);
    
    const discoveredHosts = [];
    let scannedCount = 0;
    let aliveCount = 0;
    
    // Ping each IP in the range
    for (let i = firstIp; i <= lastIp; i++) {
      const currentIp = ip.fromLong(i);
      
      // Skip network and broadcast addresses
      if (currentIp === network.networkAddress || currentIp === network.broadcastAddress) {
        continue;
      }
      
      scannedCount++;
      console.log(`[${new Date().toISOString()}] Scanning IP: ${currentIp} (${scannedCount}/${lastIp - firstIp - 1})`);
      
      const result = await ping.promise.probe(currentIp, {
        timeout: 0.1,
        extra: ['-c', '1'],
      });
      
      if (result.alive) {
        aliveCount++;
        console.log(`[${new Date().toISOString()}] Host found: ${currentIp}, response time: ${result.time}ms`);
        
        discoveredHosts.push({
          ip: currentIp,
          name: `Host-${currentIp.split('.').pop()}`,
          alive: true
        });
      }
    }
    
    console.log(`[${new Date().toISOString()}] Network discovery completed. Scanned ${scannedCount} hosts, found ${aliveCount} alive hosts.`);
    return discoveredHosts;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error discovering hosts:`, error);
    return [];
  }
}

module.exports = {
  discoverHosts
}; 