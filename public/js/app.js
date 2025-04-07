document.addEventListener('DOMContentLoaded', () => {
  // Check if Chart.js is loaded properly
  if (typeof Chart === 'undefined') {
    console.error('Chart.js is not loaded properly. Some features may not work.');
    alert('Error loading Chart.js. Please refresh the page or check your connection.');
  }

  // Global variables and constants
  let isDiscoveryRunning = false;
  let nextPingIn = 0;
  const DEFAULT_PING_INTERVAL = 60; // seconds
  const TURBO_MODE_INTERVAL = 5; // seconds
  let isTurboMode = false;
  
  // Sort state
  let currentSortMethod = 'ip'; // 'ip', 'name', or 'status'
  let currentSortDirection = 'asc'; // 'asc' or 'desc'
  
  // DOM elements
  const addTargetForm = document.getElementById('add-target-form');
  const discoverForm = document.getElementById('discover-form');
  const targetsList = document.getElementById('targets-list');
  const graphsContainer = document.getElementById('graphs');
  const targetsCounter = document.getElementById('targets-counter');
  const pingTimerValue = document.getElementById('ping-timer-value');
  const headerRight = document.querySelector('.header-right');
  
  // Add turbo mode toggle to the header
  if (headerRight) {
    const turboModeContainer = document.createElement('div');
    turboModeContainer.className = 'turbo-mode-container';
    turboModeContainer.innerHTML = `
      <input type="checkbox" id="turbo-mode-toggle" class="turbo-mode-checkbox">
      <label for="turbo-mode-toggle" class="turbo-mode-label">Turbo Mode</label>
    `;
    const firstForm = headerRight.querySelector('form');
    if (firstForm) {
      headerRight.insertBefore(turboModeContainer, firstForm);
    } else {
      headerRight.appendChild(turboModeContainer);
    }
  }
  
  const turboModeToggle = document.getElementById('turbo-mode-toggle');
  const turboModeContainer = document.querySelector('.turbo-mode-container');
  
  // Chart objects
  const charts = {};
  // Track fullscreen state
  let currentFullscreenGraph = null;
  
  // Timer variables
  let pingTimer;
  
  // Animation settings
  const headerAnimation = {
    targets: '.dashboard-header',
    translateY: [-50, 0],
    opacity: [0, 1],
    duration: 800,
    easing: 'easeOutElastic(1, .8)'
  };
  
  const graphAnimation = {
    targets: '.graph-container',
    translateY: [20, 0],
    opacity: [0, 1],
    delay: anime.stagger(100),
    duration: 600,
    easing: 'easeOutCubic'
  };
  
  // Run initial animations
  anime(headerAnimation);
  
  // Add title attribute to make it clear the timer is clickable
  const pingTimerElement = document.querySelector('.ping-timer');
  if (pingTimerElement) {
    pingTimerElement.setAttribute('title', 'Click to refresh all targets manually');
  }
  
  // Add title to turbo mode toggle
  if (turboModeContainer) {
    turboModeContainer.setAttribute('title', 'Toggle turbo mode (5-second ping intervals)');
  }
  
  // Turbo mode event listener
  if (turboModeToggle) {
    turboModeToggle.addEventListener('change', handleTurboModeToggle);
  }
  
  // Start ping timer with server sync
  syncWithServerAndStartTimer();
  
  // Load targets on page load
  loadTargets();
  
  // Event listeners
  if (addTargetForm) {
    addTargetForm.addEventListener('submit', handleAddTarget);
  }
  
  if (discoverForm) {
    discoverForm.addEventListener('submit', handleDiscoverHosts);
  }
  
  // Add click event for ping timer to allow manual refresh
  if (pingTimerElement) {
    pingTimerElement.addEventListener('click', async () => {
      // Show a small animation to indicate refresh
      anime({
        targets: pingTimerValue,
        scale: [1, 1.2, 1],
        opacity: [1, 0.7, 1],
        duration: 500,
        easing: 'easeInOutElastic(1, .6)'
      });
      
      try {
        // Call the ping endpoint
        const response = await fetch('/api/ping', { method: 'POST' });
        if (response.ok) {
          const data = await response.json();
          
          // Sync timer with server's ping cycle
          if (data.pingStatus && data.pingStatus.secondsUntilNextPing !== undefined) {
            nextPingIn = data.pingStatus.secondsUntilNextPing;
            pingTimerValue.textContent = nextPingIn;
          }
          
          // Show success notification
          const notification = document.createElement('div');
          notification.className = 'notification success';
          notification.textContent = `Manually refreshed ${data.results.length} targets`;
          document.body.appendChild(notification);
          
          anime({
            targets: notification,
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 300,
            easing: 'easeOutCubic',
            complete: function() {
              setTimeout(() => {
                anime({
                  targets: notification,
                  opacity: 0,
                  translateY: -20,
                  duration: 300,
                  easing: 'easeOutCubic',
                  complete: function() {
                    notification.remove();
                  }
                });
              }, 3000);
            }
          });
          
          // Refresh UI with new data
          loadTargets();
        }
      } catch (error) {
        console.error('Error performing manual refresh:', error);
      }
    });
  }
  
  // Sync with server and start timer
  async function syncWithServerAndStartTimer() {
    try {
      const response = await fetch('/api/ping/status');
      if (response.ok) {
        const data = await response.json();
        
        // Check if turbo mode is enabled on the server
        if (data.turboMode !== undefined && turboModeToggle) {
          isTurboMode = data.turboMode;
          turboModeToggle.checked = data.turboMode;
          
          // Update UI for turbo mode
          if (isTurboMode) {
            turboModeContainer.classList.add('active');
            if (!document.querySelector('.turbo-mode-active')) {
              const turboIndicator = document.createElement('span');
              turboIndicator.className = 'turbo-mode-active';
              turboIndicator.textContent = '⚡';
              turboModeContainer.appendChild(turboIndicator);
            }
          }
        }
        
        // Use server's secondsUntilNextPing to sync our timer, but enforce TURBO_MODE_INTERVAL if in turbo mode
        if (isTurboMode && data.secondsUntilNextPing > TURBO_MODE_INTERVAL) {
          nextPingIn = TURBO_MODE_INTERVAL;
        } else {
          nextPingIn = data.secondsUntilNextPing;
        }
        
        startPingTimer();
      } else {
        // Fall back to local timer if server sync fails
        startPingTimer();
      }
    } catch (error) {
      console.error('Error syncing with server timer:', error);
      // Fall back to local timer
      startPingTimer();
    }
  }
  
  // Re-sync with server every 5 minutes to prevent drift
  setInterval(syncWithServerAndStartTimer, 5 * 60 * 1000);
  
  // Start ping countdown timer
  function startPingTimer() {
    // Clear any existing timer
    if (pingTimer) {
      clearInterval(pingTimer);
    }
    
    // If nextPingIn is 0 or not set properly, initialize it based on current mode
    if (nextPingIn <= 0) {
      nextPingIn = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
    }
    
    // Initialize timer value
    pingTimerValue.textContent = nextPingIn;
    
    // Start countdown
    pingTimer = setInterval(() => {
      nextPingIn--;
      pingTimerValue.textContent = nextPingIn;
      
      // When timer reaches 0, reset and trigger ping
      if (nextPingIn <= 0) {
        // Reset based on current mode
        nextPingIn = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
        pingTimerValue.textContent = nextPingIn;
        loadTargets();
      }
    }, 1000);
  }
  
  // Add a new target
  async function handleAddTarget(e) {
    e.preventDefault();
    
    const ipInput = document.getElementById('target-ip');
    const nameInput = document.getElementById('target-name');
    
    // Validation - ensure IP is provided
    if (!ipInput.value) {
      alert('Please enter an IP address');
      return;
    }
    
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
        // Get the newly created target from response
        const newTarget = await response.json();
        
        // Clear inputs
        ipInput.value = '';
        nameInput.value = '';
        ipInput.focus();
        
        // Get current count and update
        let currentCount = parseInt(targetsCounter.textContent) || 0;
        targetsCounter.textContent = currentCount + 1;
        
        // Create initial status for the target (will be updated when we have real data)
        const initializedTarget = {
          ...newTarget,
          status: 'unknown',
          time: null
        };
        
        // Instantly render the new target's graph
        renderGraph(initializedTarget.ip, [], initializedTarget.name);
        
        // Find the new graph element
        const graphId = `graph-${initializedTarget.ip.replace(/\./g, '-')}`;
        const graphElement = document.getElementById(graphId);
        
        // Scroll to the new graph with smooth animation
        if (graphElement) {
          // Add highlight effect to new target
          graphElement.classList.add('new-target');
          
          // Scroll to the new graph with a small delay to ensure rendering is complete
          setTimeout(() => {
            graphElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center' 
            });
            
            // Highlight effect
            anime({
              targets: graphElement,
              boxShadow: [
                '0 0 0px rgba(52, 152, 219, 0)',
                '0 0 20px rgba(52, 152, 219, 0.8)',
                '0 0 0px rgba(52, 152, 219, 0)'
              ],
              duration: 2000,
              easing: 'easeOutCubic'
            });
            
            // Remove highlight class after animation
            setTimeout(() => {
              graphElement.classList.remove('new-target');
            }, 2000);
          }, 100);
        }
        
        // Animate success notification
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.textContent = `Target "${initializedTarget.name}" added successfully`;
        document.body.appendChild(notification);
        
        anime({
          targets: notification,
          opacity: [0, 1],
          translateY: [20, 0],
          duration: 300,
          easing: 'easeOutCubic',
          complete: function() {
            setTimeout(() => {
              anime({
                targets: notification,
                opacity: 0,
                translateY: -20,
                duration: 300,
                easing: 'easeOutCubic',
                complete: function() {
                  notification.remove();
                }
              });
            }, 3000);
          }
        });
        
        // Trigger a ping for this target immediately to get data
        try {
          const pingResponse = await fetch('/api/ping', { method: 'POST' });
          if (pingResponse.ok) {
            const pingData = await pingResponse.json();
            
            // Sync timer with server's ping cycle
            if (pingData.pingStatus && pingData.pingStatus.secondsUntilNextPing !== undefined) {
              nextPingIn = pingData.pingStatus.secondsUntilNextPing;
              pingTimerValue.textContent = nextPingIn;
            }
            
            // Update the chart with fresh data
            const resultsResponse = await fetch(`/api/results/${initializedTarget.ip}?limit=100`);
            const results = await resultsResponse.json();
            
            if (results.length > 0) {
              renderGraph(initializedTarget.ip, results, initializedTarget.name);
            }
          }
        } catch (error) {
          console.error('Error pinging new target:', error);
        }
      } else {
        const error = await response.json();
        alert(`Error: ${error.error || 'Failed to add target'}`);
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
    
    // Validation - ensure network range is provided
    if (!networkRange) {
      alert('Please enter a network range (e.g. 192.168.1.0/24)');
      return;
    }
    
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
      
      // Clear input value and reset focus
      networkRangeInput.value = '';
      networkRangeInput.focus();
      
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
  
  // Helper function to sort targets
  function sortTargets(targets, method = currentSortMethod, direction = currentSortDirection) {
    currentSortMethod = method;
    currentSortDirection = direction;
    
    return targets.sort((a, b) => {
      let comparison = 0;
      
      switch (method) {
        case 'ip':
          // Split IPs into octets and compare numerically
          const aOctets = a.ip.split('.').map(Number);
          const bOctets = b.ip.split('.').map(Number);
          
          for (let i = 0; i < 4; i++) {
            if (aOctets[i] !== bOctets[i]) {
              comparison = aOctets[i] - bOctets[i];
              break;
            }
          }
          break;
          
        case 'name':
          // Compare target names (case-insensitive)
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
          
        case 'status':
          // Default to 'unknown' if status isn't available
          const statusA = a.status || 'unknown';
          const statusB = b.status || 'unknown';
          
          // Custom status order: green, unknown, red
          const statusOrder = { 'green': 0, 'unknown': 1, 'red': 2 };
          comparison = statusOrder[statusA] - statusOrder[statusB];
          break;
      }
      
      // Apply sort direction
      return direction === 'asc' ? comparison : -comparison;
    });
  }
  
  // Add sort controls to the UI
  function addSortControls() {
    const graphsContainerHeader = document.querySelector('.graphs-container h2');
    
    if (!graphsContainerHeader) return;
    
    // Create sort controls if they don't exist yet
    if (!document.querySelector('.sort-controls')) {
      const sortControls = document.createElement('div');
      sortControls.className = 'sort-controls';
      
      sortControls.innerHTML = `
        <span class="sort-label">Sort by:</span>
        <div class="sort-buttons">
          <button class="sort-button active" data-sort="ip">IP Address</button>
          <button class="sort-button" data-sort="name">Name</button>
          <button class="sort-button" data-sort="status">Status</button>
          <button class="sort-direction" title="Toggle sort direction">
            <span class="sort-arrow">↑</span>
          </button>
        </div>
      `;
      
      graphsContainerHeader.appendChild(sortControls);
      
      // Add event listeners to sort buttons
      const sortButtons = document.querySelectorAll('.sort-button');
      sortButtons.forEach(button => {
        button.addEventListener('click', () => {
          // Remove active class from all buttons
          sortButtons.forEach(btn => btn.classList.remove('active'));
          // Add active class to clicked button
          button.classList.add('active');
          
          // Sort targets and reload
          const sortMethod = button.dataset.sort;
          fetchAndSortTargets(sortMethod, currentSortDirection);
        });
      });
      
      // Add event listener to sort direction button
      const directionButton = document.querySelector('.sort-direction');
      directionButton.addEventListener('click', () => {
        // Toggle direction
        const newDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
        
        // Update arrow indicator
        const arrow = directionButton.querySelector('.sort-arrow');
        arrow.textContent = newDirection === 'asc' ? '↑' : '↓';
        
        // Re-sort with new direction
        fetchAndSortTargets(currentSortMethod, newDirection);
      });
    }
  }
  
  // Fetch and sort targets
  async function fetchAndSortTargets(method, direction) {
    try {
      const response = await fetch('/api/targets');
      let targets = await response.json();
      
      // Show sorting banner
      showSortingBanner(method, direction);
      
      // Sort based on specified method and direction
      targets = sortTargets(targets, method, direction);
      
      // Store all existing charts to reuse them
      const existingCharts = {...charts};
      
      // Clear graphs container
      graphsContainer.innerHTML = '';
      
      // Update targets counter
      targetsCounter.textContent = targets.length;
      
      // Render the targets list
      renderTargets(targets);
      
      // Render the graphs for each target in the new sorted order
      for (const target of targets) {
        try {
          // Fetch results for this target
          const response = await fetch(`/api/results/${target.ip}?limit=100`);
          const results = await response.json();
          
          // Create a graph with the fetched data
          renderGraph(target.ip, results, target.name, existingCharts[target.ip]);
        } catch (error) {
          console.error(`Error processing ping results for ${target.ip}:`, error);
        }
      }
    } catch (error) {
      console.error('Error loading and sorting targets:', error);
    }
  }
  
  // Show sorting banner
  function showSortingBanner(method, direction) {
    // Remove any existing banner
    const existingBanner = document.querySelector('.sorting-banner');
    if (existingBanner) {
      existingBanner.remove();
    }
    
    // Create a new banner
    const banner = document.createElement('div');
    banner.className = 'sorting-banner';
    
    // Set banner content based on method and direction
    let methodText = '';
    switch (method) {
      case 'ip':
        methodText = 'IP Address';
        break;
      case 'name':
        methodText = 'Host Name';
        break;
      case 'status':
        methodText = 'Status';
        break;
    }
    
    const directionText = direction === 'asc' ? 'ascending' : 'descending';
    banner.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon">🔄</span>
        <span class="banner-text">Sorted by ${methodText} (${directionText})</span>
      </div>
    `;
    
    // Add to DOM
    document.body.appendChild(banner);
    
    // Animate in
    anime({
      targets: banner,
      opacity: [0, 1],
      translateY: ['-100%', '0'],
      duration: 400,
      easing: 'easeOutCubic'
    });
    
    // Auto-hide after a delay
    setTimeout(() => {
      anime({
        targets: banner,
        opacity: 0,
        translateY: '-100%',
        duration: 400,
        easing: 'easeOutCubic',
        complete: function() {
          banner.remove();
        }
      });
    }, 3000);
  }
  
  // Update loadTargets to preserve charts when refreshing data
  async function loadTargets() {
    try {
      const response = await fetch('/api/targets');
      let targets = await response.json();
      
      // Sort targets using the current method and direction
      targets = sortTargets(targets);
      
      // Update targets counter
      targetsCounter.textContent = targets.length;
      
      // Only clear and rebuild graphs container if it's empty or this is a manual sort
      const shouldRebuildGraphs = graphsContainer.children.length === 0;
      
      if (shouldRebuildGraphs) {
        // Clear the graphs container to ensure proper sorting
        graphsContainer.innerHTML = '';
        
        // Ensure sort controls are added
        addSortControls();
        
        // Render the targets list first
        renderTargets(targets);
        
        // Iterate over each target and load its ping results
        for (const target of targets) {
          try {
            // Now load all ping results for the graph
            loadPingResults(target.ip, target.name);
          } catch (error) {
            console.error(`Error processing ping results for ${target.ip}:`, error);
          }
        }
      } else {
        // Just update existing graphs with new data
        for (const target of targets) {
          try {
            // Only update the data without rebuilding the entire graph
            updateGraphData(target.ip, target.name);
          } catch (error) {
            console.error(`Error updating ping results for ${target.ip}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error loading targets:', error);
    }
  }
  
  // Function to update the graph data without rebuilding the entire graph
  async function updateGraphData(ip, targetName) {
    try {
      const response = await fetch(`/api/results/${ip}?limit=100`);
      const results = await response.json();
      
      if (results.length > 0) {
        // Only update data for the existing chart
        updateChartData(ip, results);
      }
    } catch (error) {
      console.error(`Error updating ping results for ${ip}:`, error);
    }
  }
  
  // Function to update just the chart data
  function updateChartData(ip, results) {
    // Check if the chart exists
    if (charts[ip]) {
      const chart = charts[ip];
      
      // Prepare data for the chart
      const labels = results.map(result => {
        const date = new Date(result.timestamp);
        return formatTimeCompact(date, results.length);
      });
      
      const data = results.map(result => result.time || null);
      
      // Get latest status
      if (results.length > 0) {
        const latestResult = results[results.length - 1];
        const status = latestResult.status || 'unknown';
        
        // Update the status in the UI
        const graphId = `graph-${ip.replace(/\./g, '-')}`;
        const graphContainer = document.getElementById(graphId);
        
        if (graphContainer) {
          const statusSpan = graphContainer.querySelector('.graph-status');
          if (statusSpan && statusSpan.textContent !== status) {
            // Animate status change
            anime({
              targets: statusSpan,
              scale: [1, 1.2, 1],
              duration: 500,
              easing: 'easeInOutElastic(1, .6)'
            });
            
            statusSpan.textContent = status;
            statusSpan.className = `graph-status ${status}`;
            
            // Update dataset attribute for sorting
            graphContainer.dataset.status = status;
          }
          
          // Always apply pulse animation to chart container when data updates
          const chartContainer = graphContainer.querySelector('.chart-container');
          
          // Remove any existing pulse classes
          chartContainer.classList.remove('chart-pulse-green', 'chart-pulse-red');
          
          // Force a reflow to ensure animation runs again
          void chartContainer.offsetWidth;
          
          // Add the appropriate pulse class based on status
          if (status === 'green') {
            chartContainer.classList.add('chart-pulse-green');
          } else if (status === 'red') {
            chartContainer.classList.add('chart-pulse-red');
          }
        }
      }
      
      // Update the chart data
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.update();
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
        <div class="dropdown">
          <button class="dropdown-toggle" title="Options">
            <div class="dots">
              <div class="dot"></div>
              <div class="dot"></div>
              <div class="dot"></div>
            </div>
          </button>
          <div class="dropdown-menu">
            <div class="dropdown-item" data-action="fullscreen" data-ip="${target.ip}">
              <span class="icon">↗️</span> Full Screen
            </div>
            <div class="dropdown-item" data-action="reset" data-ip="${target.ip}">
              <span class="icon">🔄</span> Reset Data
            </div>
            <div class="dropdown-item danger" data-action="remove" data-ip="${target.ip}">
              <span class="icon">🗑️</span> Remove Host
            </div>
          </div>
        </div>
      `;
      
      targetsList.appendChild(targetCard);
    });
  }
  
  // Handle dropdown menu clicks
  document.addEventListener('click', (e) => {
    // Close all dropdown menus when clicking outside
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.classList.remove('show');
      });
    }
    
    // Toggle dropdown menu when clicking on the toggle button
    if (e.target.closest('.dropdown-toggle')) {
      const menu = e.target.closest('.dropdown').querySelector('.dropdown-menu');
      menu.classList.toggle('show');
      e.stopPropagation();
    }
    
    // Handle dropdown menu item clicks
    if (e.target.closest('.dropdown-item')) {
      const item = e.target.closest('.dropdown-item');
      const action = item.dataset.action;
      const ip = item.dataset.ip;
      
      if (action && ip) {
        handleDropdownAction(action, ip);
      }
      
      // Close the dropdown menu
      item.closest('.dropdown-menu').classList.remove('show');
      e.stopPropagation();
    }
  });
  
  // Handle dropdown menu actions
  function handleDropdownAction(action, ip) {
    switch (action) {
      case 'fullscreen':
        openFullscreen(ip);
        break;
      case 'reset':
        resetHostData(ip);
        break;
      case 'remove':
        removeTarget(ip);
        break;
    }
  }
  
  // Open graph in fullscreen mode
  function openFullscreen(ip) {
    const graphId = `graph-${ip.replace(/\./g, '-')}`;
    const graphContainer = document.getElementById(graphId);
    
    if (!graphContainer) return;
    
    // Get the graph header content
    const headerContent = graphContainer.querySelector('.graph-header').innerHTML;
    const chartCanvas = graphContainer.querySelector('canvas');
    
    // Create fullscreen container
    const fullscreenContainer = document.createElement('div');
    fullscreenContainer.className = 'fullscreen-graph';
    fullscreenContainer.innerHTML = `
      <div class="fullscreen-header">
        <div class="header-content">${headerContent}</div>
        <button class="exit-fullscreen">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L15 15M1 15L15 1" stroke="currentColor" stroke-width="2"/>
          </svg>
          Exit Fullscreen
        </button>
      </div>
      <div class="fullscreen-chart-container">
        <canvas id="fullscreen-chart"></canvas>
      </div>
    `;
    
    document.body.appendChild(fullscreenContainer);
    
    // Track current fullscreen graph
    currentFullscreenGraph = {
      ip: ip,
      container: fullscreenContainer
    };
    
    // Create a new chart in fullscreen mode
    const fullscreenChart = document.getElementById('fullscreen-chart');
    if (charts[ip]) {
      const chartConfig = charts[ip].config;
      
      // Create a new chart with the same data but optimized for fullscreen
      const fsChart = new Chart(fullscreenChart, {
        type: chartConfig.type,
        data: JSON.parse(JSON.stringify(chartConfig.data)), // Deep clone data
        options: {
          ...chartConfig.options,
          maintainAspectRatio: false,
          responsive: true,
          animation: {
            duration: 800,
            easing: 'easeOutQuart'
          },
          scales: {
            y: {
              ...chartConfig.options.scales.y,
              ticks: {
                ...chartConfig.options.scales.y.ticks,
                font: {
                  size: 14
                }
              },
              title: {
                display: true,
                text: 'Response Time (ms)',
                font: {
                  size: 16
                }
              }
            },
            x: {
              ...chartConfig.options.scales.x,
              ticks: {
                ...chartConfig.options.scales.x.ticks,
                font: {
                  size: 12
                },
                maxTicksLimit: 15 // Show more ticks in fullscreen mode
              },
              title: {
                display: true,
                text: 'Time',
                font: {
                  size: 16
                }
              }
            }
          },
          plugins: {
            ...chartConfig.options.plugins,
            tooltip: {
              ...chartConfig.options.plugins.tooltip,
              titleFont: {
                size: 16
              },
              bodyFont: {
                size: 14
              }
            }
          }
        }
      });
      
      // Add exit fullscreen event listener
      const exitBtn = fullscreenContainer.querySelector('.exit-fullscreen');
      exitBtn.addEventListener('click', () => {
        fullscreenContainer.remove();
        currentFullscreenGraph = null;
      });
    }
  }
  
  // Reset host data
  async function resetHostData(ip) {
    if (!confirm(`Are you sure you want to reset data for ${ip}? This will clear its ping history.`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/targets/${ip}/reset`, {
        method: 'POST'
      });
      
      if (response.ok) {
        // Show success notification
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.textContent = `Data for ${ip} has been reset`;
        document.body.appendChild(notification);
        
        anime({
          targets: notification,
          opacity: [0, 1],
          translateY: [20, 0],
          duration: 300,
          easing: 'easeOutCubic',
          complete: function() {
            setTimeout(() => {
              anime({
                targets: notification,
                opacity: 0,
                translateY: -20,
                duration: 300,
                easing: 'easeOutCubic',
                complete: function() {
                  notification.remove();
                }
              });
            }, 3000);
          }
        });
        
        // Reload the target's data
        loadPingResults(ip);
      } else {
        alert('Failed to reset target data.');
      }
    } catch (error) {
      console.error('Error resetting target data:', error);
      alert('Failed to reset target data. Check console for details.');
    }
  }
  
  // Remove a target with animation
  async function removeTarget(ip) {
    if (!confirm(`Are you sure you want to remove ${ip} from monitoring?`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/targets/${ip}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        // Get current count and update
        let currentCount = parseInt(targetsCounter.textContent) || 0;
        if (currentCount > 0) {
          targetsCounter.textContent = currentCount - 1;
        }
        
        // Get the graph element
        const graphElement = document.getElementById(`graph-${ip.replace(/\./g, '-')}`);
        
        if (graphElement) {
          // Animate the removal
          anime({
            targets: graphElement,
            opacity: [1, 0],
            translateY: [0, -20],
            duration: 500,
            easing: 'easeOutCubic',
            complete: function() {
              // Remove chart if it exists
              if (charts[ip]) {
                charts[ip].destroy();
                delete charts[ip];
              }
              
              graphElement.remove();
            }
          });
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
  async function loadPingResults(ip, targetName) {
    try {
      const response = await fetch(`/api/results/${ip}?limit=100`);
      const results = await response.json();
      
      // Check if we already have a chart for this IP
      const existingChart = charts[ip];
      
      if (results.length > 0) {
        renderGraph(ip, results, targetName, existingChart);
      } else {
        // Still render the graph but with empty data
        renderGraph(ip, [], targetName, existingChart);
      }
    } catch (error) {
      console.error(`Error loading ping results for ${ip}:`, error);
    }
  }
  
  // Render a graph for a target
  function renderGraph(ip, results, targetName, existingChart = null) {
    const graphId = `graph-${ip.replace(/\./g, '-')}`;
    let graphContainer = document.getElementById(graphId);
    let isNewGraph = false;
    let status = 'unknown';
    let statusChanged = false;
    
    // Get latest status from results if available
    if (results.length > 0) {
      const latestResult = results[results.length - 1];
      const newStatus = latestResult.status || 'unknown';
      
      // Check if status has changed
      if (graphContainer) {
        const currentStatusEl = graphContainer.querySelector('.graph-status');
        if (currentStatusEl && currentStatusEl.textContent !== newStatus) {
          statusChanged = true;
        }
      }
      
      status = newStatus;
    }
    
    if (!graphContainer) {
      isNewGraph = true;
      graphContainer = document.createElement('div');
      graphContainer.id = graphId;
      graphContainer.className = 'graph-container';
      graphContainer.style.opacity = 0;
      graphContainer.dataset.ip = ip;
      graphContainer.dataset.status = status;
      
      // Use the provided name or find a target name for this IP
      let displayName = targetName || ip;
      
      // If no name was provided, look it up
      if (!targetName) {
        // Method 1: Check targets already in DOM
        const targetCards = document.querySelectorAll('.target-card');
        for (const card of targetCards) {
          const ipText = card.querySelector('p').textContent;
          if (ipText.includes(ip)) {
            displayName = card.querySelector('h3').textContent;
            break;
          }
        }
        
        // Method 2: If still not found, fetch from API
        if (displayName === ip) {
          // Try to fetch the target info from API
          fetch(`/api/targets`)
            .then(response => response.json())
            .then(targets => {
              const targetInfo = targets.find(t => t.ip === ip);
              if (targetInfo && targetInfo.name) {
                const headerElement = graphContainer.querySelector('h3');
                if (headerElement) {
                  // Extract the status span if it exists
                  const statusSpan = headerElement.querySelector('.graph-status');
                  // Update the header with the correct name
                  headerElement.innerHTML = `${targetInfo.name} <span class="graph-details">(${ip}) - `;
                  // Re-add the status span if it was there
                  if (statusSpan) {
                    headerElement.querySelector('.graph-details').appendChild(statusSpan);
                  } else {
                    headerElement.querySelector('.graph-details').innerHTML += `<span class="graph-status ${status}">${status}</span></span>`;
                  }
                }
              }
            })
            .catch(error => console.error('Error fetching target name:', error));
        }
      }
      
      graphContainer.innerHTML = `
        <div class="graph-header">
          <h3>${displayName} <span class="graph-details">(${ip}) - <span class="graph-status ${status}">${status}</span></span></h3>
          <div class="dropdown">
            <button class="dropdown-toggle" title="Options">
              <div class="dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
              </div>
            </button>
            <div class="dropdown-menu">
              <div class="dropdown-item" data-action="fullscreen" data-ip="${ip}">
                <span class="icon">↗️</span> Full Screen
              </div>
              <div class="dropdown-item" data-action="reset" data-ip="${ip}">
                <span class="icon">🔄</span> Reset Data
              </div>
              <div class="dropdown-item danger" data-action="remove" data-ip="${ip}">
                <span class="icon">🗑️</span> Remove Host
              </div>
            </div>
          </div>
        </div>
        <div class="chart-container">
          <canvas id="chart-${graphId}"></canvas>
        </div>
      `;
      
      graphsContainer.appendChild(graphContainer);
      
      // Animate the new graph
      anime({
        targets: graphContainer,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 600,
        delay: 100,
        easing: 'easeOutCubic'
      });
    } else {
      // Update the status if we have new results
      if (results.length > 0) {
        const statusSpan = graphContainer.querySelector('.graph-status');
        
        if (statusSpan) {
          // Check if status has changed
          if (statusSpan.textContent !== status) {
            // Animate status change
            anime({
              targets: statusSpan,
              scale: [1, 1.2, 1],
              duration: 500,
              easing: 'easeInOutElastic(1, .6)'
            });
            
            statusSpan.textContent = status;
            statusSpan.className = `graph-status ${status}`;
            
            // Update dataset attribute for sorting
            graphContainer.dataset.status = status;
            
            // If we're sorting by status, re-sort the graphs
            if (currentSortMethod === 'status' && statusChanged) {
              // Wait a little to allow the animation to complete
              setTimeout(() => fetchAndSortTargets(currentSortMethod, currentSortDirection), 600);
            }
          }
        }
      }
      
      // Always apply pulse animation to chart container when updating data
      const chartContainer = graphContainer.querySelector('.chart-container');
      
      // Remove any existing pulse classes
      chartContainer.classList.remove('chart-pulse-green', 'chart-pulse-red');
      
      // Force a reflow to ensure animation runs again
      void chartContainer.offsetWidth;
      
      // Add the appropriate pulse class based on status
      if (status === 'green') {
        chartContainer.classList.add('chart-pulse-green');
      } else if (status === 'red') {
        chartContainer.classList.add('chart-pulse-red');
      }
      
      // If this graph is currently in fullscreen, update the fullscreen chart too
      if (currentFullscreenGraph && currentFullscreenGraph.ip === ip) {
        const fullscreenChart = document.getElementById('fullscreen-chart');
        if (fullscreenChart && charts[ip]) {
          const fsChart = new Chart(fullscreenChart.getContext('2d'), {
            type: charts[ip].config.type,
            data: JSON.parse(JSON.stringify(charts[ip].data)),
            options: charts[ip].options
          });
        }
      }
    }
    
    const chartCanvas = document.getElementById(`chart-${graphId}`);
    
    // Prepare data for the chart
    const labels = results.map(result => {
      const date = new Date(result.timestamp);
      // Use a more compact time format (HH:MM or HH:MM:SS based on data density)
      return formatTimeCompact(date, results.length);
    });
    
    const data = results.map(result => result.time || null);
    
    // Use the createOrUpdateChart function with error handling
    createOrUpdateChart(ip, chartCanvas, labels, data, existingChart);
  }
  
  // Handle turbo mode toggle
  async function handleTurboModeToggle() {
    const isEnabled = turboModeToggle.checked;
    
    try {
      const response = await fetch('/api/ping/turbo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: isEnabled })
      });
      
      if (response.ok) {
        const data = await response.json();
        isTurboMode = data.turboMode;
        
        // Immediately update the ping timer value based on turbo mode
        nextPingIn = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
        pingTimerValue.textContent = nextPingIn;
        
        // Update the UI to show turbo mode is active
        if (turboModeContainer) {
          if (isTurboMode) {
            turboModeContainer.classList.add('active');
            
            if (!document.querySelector('.turbo-mode-active')) {
              const turboIndicator = document.createElement('span');
              turboIndicator.className = 'turbo-mode-active';
              turboIndicator.textContent = '⚡';
              turboModeContainer.appendChild(turboIndicator);
            }
          } else {
            turboModeContainer.classList.remove('active');
            const turboIndicator = document.querySelector('.turbo-mode-active');
            if (turboIndicator) {
              turboIndicator.remove();
            }
          }
        }
        
        // Restart the timer with the updated interval
        updateRefreshTimer();
      }
    } catch (error) {
      console.error('Error toggling turbo mode:', error);
      // Revert toggle state on error
      turboModeToggle.checked = !isEnabled;
    }
  }
  
  // Create a refresh timer that adapts to current mode
  let refreshTimer;
  
  function updateRefreshTimer() {
    // Clear any existing timer
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    
    // Set up new timer with correct interval
    const interval = isTurboMode ? TURBO_MODE_INTERVAL * 1000 : DEFAULT_PING_INTERVAL * 1000;
    
    refreshTimer = setInterval(() => {
      // Only load if the timer is close to zero to avoid double refresh
      if (nextPingIn <= 1) {
        // For debug
        console.log('Auto-refreshing targets data');
        loadTargets();
      }
    }, interval);
  }
  
  // Initialize the refresh timer
  updateRefreshTimer();
  
  // Update the timer when turbo mode changes
  turboModeToggle.addEventListener('change', () => {
    updateRefreshTimer();
  });

  // Create or update chart - wrapped in try-catch to handle potential Chart.js errors
  function createOrUpdateChart(ip, chartCanvas, labels, data, existingChart = null) {
    try {
      // Get the latest status for adding pulse animation
      let status = 'unknown';
      if (data.length > 0) {
        const latestValue = data[data.length - 1];
        status = latestValue === null ? 'red' : 'green';
      }
      
      // Apply pulse animation to chart container
      const chartContainer = chartCanvas.closest('.chart-container');
      if (chartContainer) {
        // Remove any existing pulse classes
        chartContainer.classList.remove('chart-pulse-green', 'chart-pulse-red');
        
        // Force a reflow to ensure animation runs again
        void chartContainer.offsetWidth;
        
        // Add the appropriate pulse class based on status
        if (status === 'green') {
          chartContainer.classList.add('chart-pulse-green');
        } else if (status === 'red') {
          chartContainer.classList.add('chart-pulse-red');
        }
      }
      
      if (charts[ip]) {
        charts[ip].data.labels = labels;
        charts[ip].data.datasets[0].data = data;
        charts[ip].update();
      } else if (existingChart) {
        // If we have an existing chart configuration, reuse it
        const newChart = new Chart(chartCanvas, {
          type: existingChart.config.type,
          data: {
            labels: labels,
            datasets: [{
              label: 'Response Time (ms)',
              data: data,
              borderColor: existingChart.data.datasets[0].borderColor,
              backgroundColor: existingChart.data.datasets[0].backgroundColor,
              borderWidth: existingChart.data.datasets[0].borderWidth,
              tension: existingChart.data.datasets[0].tension,
              pointRadius: existingChart.data.datasets[0].pointRadius,
              pointBackgroundColor: existingChart.data.datasets[0].pointBackgroundColor
            }]
          },
          options: existingChart.config.options
        });
        
        charts[ip] = newChart;
      } else {
        charts[ip] = new Chart(chartCanvas, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Response Time (ms)',
              data: data,
              borderColor: 'rgba(52, 152, 219, 1)',
              backgroundColor: 'rgba(52, 152, 219, 0.2)',
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 3,
              pointBackgroundColor: function(context) {
                // Color points based on status (red = timeout/error, green = success)
                const value = context.dataset.data[context.dataIndex];
                return value === null ? 'rgba(231, 76, 60, 1)' : 'rgba(46, 204, 113, 1)';
              }
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              duration: 1000,
              easing: 'easeOutQuart'
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: {
                  color: 'rgba(255, 255, 255, 0.05)'
                },
                border: {
                  color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                  color: 'rgba(255, 255, 255, 0.7)',
                  font: {
                    size: 10
                  }
                }
              },
              x: {
                grid: {
                  color: 'rgba(255, 255, 255, 0.05)'
                },
                border: {
                  color: 'rgba(255, 255, 255, 0.1)'
                },
                ticks: {
                  color: 'rgba(255, 255, 255, 0.7)',
                  maxTicksLimit: 8,
                  maxRotation: 0,
                  font: {
                    size: 10
                  }
                }
              }
            },
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(45, 45, 45, 0.9)',
                titleColor: 'rgba(255, 255, 255, 0.9)',
                bodyColor: 'rgba(255, 255, 255, 0.8)',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderWidth: 1,
                callbacks: {
                  label: function(context) {
                    const value = context.parsed.y;
                    return value === null ? 'Timeout/Error' : `${value} ms`;
                  }
                }
              }
            }
          }
        });
      }
      return true;
    } catch (error) {
      console.error(`Error creating/updating chart for ${ip}:`, error);
      
      // Create fallback display if needed
      const chartContainer = chartCanvas.closest('.chart-container');
      if (chartContainer) {
        // Only add fallback if container exists and doesn't already have the fallback
        if (!chartContainer.querySelector('.chart-fallback')) {
          const fallback = document.createElement('div');
          fallback.className = 'chart-fallback';
          fallback.innerHTML = `
            <div class="fallback-message">
              <p>Chart rendering error. Please try refreshing the page.</p>
              <p class="fallback-data">${data.length} data points collected</p>
              <p class="fallback-status">Latest status: ${data.length > 0 ? (data[data.length-1] === null ? 'Error' : 'OK') : 'Unknown'}</p>
            </div>
          `;
          chartContainer.appendChild(fallback);
          
          // Hide the canvas
          chartCanvas.style.display = 'none';
        }
      }
      return false;
    }
  }

  // Helper function to format time in a compact way
  function formatTimeCompact(date, totalPoints) {
    // If we have many data points, show even more compact time (just hours:minutes)
    if (totalPoints > 20) {
      return date.getHours().toString().padStart(2, '0') + ':' + 
             date.getMinutes().toString().padStart(2, '0');
    } else {
      // For fewer points, include seconds but still formatted compactly
      return date.getHours().toString().padStart(2, '0') + ':' + 
             date.getMinutes().toString().padStart(2, '0') + ':' + 
             date.getSeconds().toString().padStart(2, '0');
    }
  }
}); 