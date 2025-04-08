const ping = require('ping');
const ip = require('ip');
const db = require('../db/database');

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
          name: generateDrunkenHostName(),
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