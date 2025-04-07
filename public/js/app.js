document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const addTargetForm = document.getElementById('add-target-form');
  const discoverForm = document.getElementById('discover-form');
  const targetsList = document.getElementById('targets-list');
  const graphsContainer = document.getElementById('graphs');
  
  // Chart objects
  const charts = {};
  
  // Load targets on page load
  loadTargets();
  
  // Event listeners
  addTargetForm.addEventListener('submit', handleAddTarget);
  discoverForm.addEventListener('submit', handleDiscoverHosts);
  
  // Refresh data every 60 seconds
  setInterval(loadTargets, 60000);
  
  // Add a global variable to track discovery state
  let isDiscoveryRunning = false;
  
  // Add a new target
  async function handleAddTarget(e) {
    e.preventDefault();
    
    const ipInput = document.getElementById('target-ip');
    const nameInput = document.getElementById('target-name');
    
    const target = {
      ip: ipInput.value,
      name: nameInput.value || `Host-${ipInput.value.split('.').pop()}`
    };
    
    try {
      const response = await fetch('/api/targets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(target)
      });
      
      if (response.ok) {
        ipInput.value = '';
        nameInput.value = '';
        loadTargets();
      } else {
        const error = await response.json();
        alert(`Error: ${error.message || 'Failed to add target'}`);
      }
    } catch (error) {
      console.error('Error adding target:', error);
      alert('Failed to add target. Check console for details.');
    }
  }
  
  // Discover hosts in a network range
  async function handleDiscoverHosts(e) {
    e.preventDefault();
    
    // Prevent starting a second discovery if one is already running
    if (isDiscoveryRunning) {
      alert('A network discovery is already in progress. Please wait for it to complete.');
      return;
    }
    
    const networkRangeInput = document.getElementById('network-range');
    const networkRange = networkRangeInput.value;
    
    // Set discovery state to running
    isDiscoveryRunning = true;
    
    // Show loading modal with improved progress display
    showModal('Discovering hosts...', `
      <p>Scanning network range ${networkRange}</p>
      <div class="discovery-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: 0%"></div>
        </div>
        <div class="progress-text">0%</div>
      </div>
      <div class="discovery-stats">
        <p>Hosts scanned: <span id="hosts-scanned">0</span></p>
        <p>Hosts found: <span id="hosts-found">0</span></p>
        <p>Current IP: <span id="current-ip">-</span></p>
      </div>
      <div class="discovery-log-container">
        <h4>Discovery Log:</h4>
        <div id="discovery-log" class="discovery-log"></div>
      </div>
    `);
    
    // Create array to store discovered hosts
    const discoveredHosts = [];
    
    try {
      const response = await fetch('/api/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ networkRange })
      });
      
      // Check if the response indicates a conflict (409)
      if (response.status === 409) {
        const error = await response.json();
        showModal('Error', `<p>${error.error || 'Another discovery is already in progress'}</p>`);
        isDiscoveryRunning = false;
        return;
      }
      
      // Set up a reader to process the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let buffer = '';
      
      // Process the stream
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete JSON objects in the buffer
        let jsonEndIndex;
        while ((jsonEndIndex = buffer.indexOf('}')) !== -1) {
          try {
            const jsonStr = buffer.substring(0, jsonEndIndex + 1);
            buffer = buffer.substring(jsonEndIndex + 1);
            
            const data = JSON.parse(jsonStr);
            
            // Handle different message types
            if (data.type === 'progress') {
              updateDiscoveryProgress(data);
            } else if (data.type === 'host') {
              discoveredHosts.push(data.host);
              addHostToDiscoveryLog(data.host, data);
            } else if (data.type === 'complete') {
              // Discovery complete
              showDiscoveryResults(discoveredHosts);
            } else if (data.type === 'error') {
              showModal('Error', `<p>Error: ${data.message}</p>`);
            }
          } catch (e) {
            console.error('Error parsing JSON:', e, buffer);
            buffer = '';
          }
        }
      }
    } catch (error) {
      console.error('Error discovering hosts:', error);
      showModal('Error', '<p>Failed to discover hosts. Check console for details.</p>');
    } finally {
      // Set discovery state to not running, regardless of success or failure
      isDiscoveryRunning = false;
    }
  }
  
  // Update discovery progress in the modal
  function updateDiscoveryProgress(data) {
    const progressFill = document.querySelector('.progress-fill');
    const progressText = document.querySelector('.progress-text');
    const hostsScanned = document.getElementById('hosts-scanned');
    const hostsFound = document.getElementById('hosts-found');
    const currentIp = document.getElementById('current-ip');
    
    if (progressFill && progressText && hostsScanned && hostsFound && currentIp) {
      // Calculate percentage and cap at 100%
      let percent = Math.round((data.scanned / data.total) * 100);
      percent = Math.min(percent, 100); // Ensure it never exceeds 100%
      
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${percent}%`;
      hostsScanned.textContent = data.scanned;
      hostsFound.textContent = data.found;
      
      if (data.currentIp) {
        currentIp.textContent = data.currentIp;
        
        // Log every host scan
        addScanLogEntry(data.currentIp, 'scanning');
      }
    }
  }
  
  // Add a host to the discovery log
  function addHostToDiscoveryLog(host, data) {
    const log = document.getElementById('discovery-log');
    
    if (log) {
      const logEntry = document.createElement('div');
      logEntry.className = 'log-entry found'; // Add 'found' class to highlight
      
      // Show different message based on whether the host was added or already existed
      const statusText = data.alreadyExists ? 
        '<span class="log-exists">Already monitored</span>' : 
        '<span class="log-added">✓ Added</span>';
      
      logEntry.innerHTML = `
        <span class="log-time">${new Date().toLocaleTimeString()}</span>
        <span class="log-host">${host.name} (${host.ip})</span>
        <span class="log-time">${host.time}ms</span>
        ${statusText}
      `;
      
      log.appendChild(logEntry);
      log.scrollTop = log.scrollHeight; // Auto-scroll to bottom
    }
  }
  
  // Add a function to log scanning activity (not just found hosts)
  function addScanLogEntry(ip, status) {
    const log = document.getElementById('discovery-log');
    
    if (log) {
      const logEntry = document.createElement('div');
      logEntry.className = 'log-entry' + (status === 'found' ? ' found' : '');
      logEntry.innerHTML = `
        <span class="log-time">${new Date().toLocaleTimeString()}</span>
        <span class="log-host">Scanning ${ip}</span>
        <span class="log-status">${status === 'found' ? 'FOUND' : 'no response'}</span>
      `;
      
      log.appendChild(logEntry);
      
      // Keep only the last 200 entries to prevent performance issues
      while (log.children.length > 200) {
        log.removeChild(log.firstChild);
      }
      
      log.scrollTop = log.scrollHeight; // Auto-scroll to bottom
    }
  }
  
  // Show discovery results
  function showDiscoveryResults(hosts) {
    // Reset discovery state
    isDiscoveryRunning = false;
    
    if (hosts.length === 0) {
      showModal('Discovery Results', '<p>No hosts found in the specified range.</p>');
      return;
    }
    
    // Show discovered hosts in modal with message that they were already added
    let hostsHtml = `
      <p>Found ${hosts.length} hosts. All discovered hosts have been automatically added to monitoring.</p>
      <div class="discovered-hosts">`;
    
    hosts.forEach(host => {
      hostsHtml += `
        <div class="host-item">
          <div class="host-info">
            ${host.name} (${host.ip}) - Response time: ${host.time}ms
          </div>
        </div>
      `;
    });
    
    hostsHtml += `</div>
      <div class="modal-actions">
        <button id="close-discovery" class="primary-btn">Close</button>
      </div>`;
    
    showModal('Discovery Results', hostsHtml);
    
    // Add event listener to close button
    document.getElementById('close-discovery').addEventListener('click', () => {
      closeModal();
      // Refresh the targets list to show the newly added hosts
      loadTargets();
    });
  }
  
  // Add discovered hosts to monitoring
  async function addDiscoveredHosts(hosts) {
    for (const host of hosts) {
      try {
        await fetch('/api/targets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(host)
        });
      } catch (error) {
        console.error(`Error adding host ${host.ip}:`, error);
      }
    }
    
    loadTargets();
  }
  
  // Show modal with content
  function showModal(title, content) {
    let modal = document.getElementById('discovery-modal');
    
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'discovery-modal';
      modal.className = 'modal';
      document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>${title}</h3>
          <span class="close-modal">&times;</span>
        </div>
        <div class="modal-body">
          ${content}
        </div>
      </div>
    `;
    
    modal.style.display = 'block';
    
    // Add event listener to close button
    const closeBtn = modal.querySelector('.close-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }
  
  // Close modal
  function closeModal() {
    const modal = document.getElementById('discovery-modal');
    if (modal) {
      modal.style.display = 'none';
      
      // If this was a discovery modal that's being closed, ensure we reset the state
      if (isDiscoveryRunning) {
        isDiscoveryRunning = false;
      }
    }
  }
  
  // Load all targets and their data
  async function loadTargets() {
    try {
      const response = await fetch('/api/targets');
      const targets = await response.json();
      
      renderTargets(targets);
      
      // Load ping results for each target
      for (const target of targets) {
        loadPingResults(target.ip);
      }
    } catch (error) {
      console.error('Error loading targets:', error);
    }
  }
  
  // Render targets list
  function renderTargets(targets) {
    targetsList.innerHTML = '';
    
    if (targets.length === 0) {
      targetsList.innerHTML = '<p>No targets added yet. Add a target to start monitoring.</p>';
      return;
    }
    
    targets.forEach(target => {
      const targetCard = document.createElement('div');
      targetCard.className = `target-card ${target.status || 'unknown'}`;
      targetCard.innerHTML = `
        <h3>${target.name}</h3>
        <p>IP: ${target.ip}</p>
        <p>Status: <span class="status">${target.status || 'Unknown'}</span></p>
        <p>Last Response: <span class="response-time">${target.time ? `${target.time} ms` : 'N/A'}</span></p>
        <button class="remove-btn" data-ip="${target.ip}">×</button>
      `;
      
      targetsList.appendChild(targetCard);
      
      // Add event listener to remove button
      const removeBtn = targetCard.querySelector('.remove-btn');
      removeBtn.addEventListener('click', () => removeTarget(target.ip));
    });
  }
  
  // Remove a target
  async function removeTarget(ip) {
    if (!confirm(`Are you sure you want to remove ${ip} from monitoring?`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/targets/${ip}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        // Remove chart if it exists
        if (charts[ip]) {
          charts[ip].destroy();
          delete charts[ip];
          
          const graphElement = document.getElementById(`graph-${ip.replace(/\./g, '-')}`);
          if (graphElement) {
            graphElement.remove();
          }
        }
        
        loadTargets();
      } else {
        alert('Failed to remove target.');
      }
    } catch (error) {
      console.error('Error removing target:', error);
      alert('Failed to remove target. Check console for details.');
    }
  }
  
  // Load ping results for a target
  async function loadPingResults(ip) {
    try {
      const response = await fetch(`/api/results/${ip}?limit=100`);
      const results = await response.json();
      
      if (results.length > 0) {
        renderGraph(ip, results);
        
        // Update status in the target card
        const latestResult = results[results.length - 1];
        const targetCard = Array.from(document.querySelectorAll('.target-card'))
          .find(card => card.querySelector('p').textContent.includes(ip));
        
        if (targetCard) {
          targetCard.className = `target-card ${latestResult.status}`;
          targetCard.querySelector('.status').textContent = latestResult.status;
          targetCard.querySelector('.response-time').textContent = 
            latestResult.time ? `${latestResult.time} ms` : 'N/A';
        }
      }
    } catch (error) {
      console.error(`Error loading ping results for ${ip}:`, error);
    }
  }
  
  // Render a graph for a target
  function renderGraph(ip, results) {
    const graphId = `graph-${ip.replace(/\./g, '-')}`;
    let graphContainer = document.getElementById(graphId);
    
    if (!graphContainer) {
      graphContainer = document.createElement('div');
      graphContainer.id = graphId;
      graphContainer.className = 'graph-container';
      
      // Find matching target to get the name
      const targets = document.querySelectorAll('.target-card');
      let targetName = ip;
      let status = 'unknown';
      
      // Try to find the target name from the DOM
      for (const target of targets) {
        const ipText = target.querySelector('p').textContent;
        if (ipText.includes(ip)) {
          targetName = target.querySelector('h3').textContent;
          const statusSpan = target.querySelector('.status');
          if (statusSpan) {
            status = statusSpan.textContent;
          }
          break;
        }
      }
      
      // Get latest status from results if available
      if (results.length > 0) {
        const latestResult = results[results.length - 1];
        status = latestResult.status || status;
      }
      
      graphContainer.innerHTML = `
        <div class="graph-header">
          <h3>${targetName} <span class="graph-details">(${ip}) - <span class="graph-status ${status}">${status}</span></span></h3>
          <button class="remove-btn" data-ip="${ip}" title="Remove ${targetName} from monitoring">×</button>
        </div>
        <div class="chart-container">
          <canvas id="chart-${graphId}"></canvas>
        </div>
      `;
      
      graphsContainer.appendChild(graphContainer);
      
      // Add event listener to the remove button
      const removeBtn = graphContainer.querySelector('.remove-btn');
      removeBtn.addEventListener('click', () => removeTarget(ip));
    } else {
      // Update the status if we have new results
      if (results.length > 0) {
        const latestResult = results[results.length - 1];
        const statusSpan = graphContainer.querySelector('.graph-status');
        if (statusSpan && latestResult.status) {
          statusSpan.textContent = latestResult.status;
          statusSpan.className = `graph-status ${latestResult.status}`;
        }
      }
    }
    
    const chartCanvas = document.getElementById(`chart-${graphId}`);
    
    // Prepare data for the chart
    const labels = results.map(result => {
      const date = new Date(result.timestamp);
      return date.toLocaleTimeString();
    });
    
    const data = results.map(result => result.time || null);
    
    // Create or update chart
    if (charts[ip]) {
      charts[ip].data.labels = labels;
      charts[ip].data.datasets[0].data = data;
      charts[ip].update();
    } else {
      charts[ip] = new Chart(chartCanvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Response Time (ms)',
            data: data,
            borderColor: 'rgba(75, 192, 192, 1)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            borderWidth: 2,
            tension: 0.1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Response Time (ms)'
              }
            },
            x: {
              title: {
                display: true,
                text: 'Time'
              }
            }
          }
        }
      });
    }
  }
}); 