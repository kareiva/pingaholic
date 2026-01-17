// Global variables that need to be accessible outside the DOMContentLoaded event
let isInitialLoad = true;
const charts = {};
let graphsContainer, targetsCounter, targetsList;
let selectedTimeInterval = 60; // Default to 1 hour (in minutes)
let globalMaxPingTime = 100; // Global max ping time for Y-axis alignment (default 100ms)
let currentViewMode = 'classic'; // Default to classic view

// Helper function to sort targets (simplified to only sort by IP)
function sortTargets(targets) {
  return targets.sort((a, b) => {
    // Split IPs into octets and compare numerically
    const aOctets = a.ip.split('.').map(Number);
    const bOctets = b.ip.split('.').map(Number);
    
    for (let i = 0; i < 4; i++) {
      if (aOctets[i] !== bOctets[i]) {
        return aOctets[i] - bOctets[i];
      }
    }
    return 0;
  });
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

// Helper function to filter and pad ping results based on selected time interval
function filterAndPadResults(results, timeIntervalMinutes) {
  const now = Date.now();
  const timeRangeMs = timeIntervalMinutes * 60 * 1000;
  const startTime = now - timeRangeMs;

  // Filter results to only include those within the time range
  const filteredResults = results.filter(result => result.timestamp >= startTime);

  // Determine appropriate interval for data points based on time range
  let intervalMs;
  if (timeIntervalMinutes <= 1) {
    intervalMs = 5 * 1000; // 5 seconds for last minute
  } else if (timeIntervalMinutes <= 5) {
    intervalMs = 15 * 1000; // 15 seconds for last 5 minutes
  } else if (timeIntervalMinutes <= 15) {
    intervalMs = 30 * 1000; // 30 seconds for last 15 minutes
  } else if (timeIntervalMinutes <= 60) {
    intervalMs = 60 * 1000; // 1 minute for last hour
  } else if (timeIntervalMinutes <= 480) {
    intervalMs = 5 * 60 * 1000; // 5 minutes for last 8 hours
  } else if (timeIntervalMinutes <= 1440) {
    intervalMs = 15 * 60 * 1000; // 15 minutes for last 24 hours
  } else {
    intervalMs = 60 * 60 * 1000; // 1 hour for last 72 hours
  }

  // Create continuous data points
  const paddedResults = [];
  let currentTime = startTime;

  while (currentTime <= now) {
    // Find the closest result to this time point
    const closestResult = filteredResults.reduce((closest, result) => {
      const currentDiff = Math.abs(result.timestamp - currentTime);
      const closestDiff = closest ? Math.abs(closest.timestamp - currentTime) : Infinity;

      // Only use results within half the interval
      if (currentDiff < intervalMs / 2 && currentDiff < closestDiff) {
        return result;
      }
      return closest;
    }, null);

    // Add the result or a null placeholder
    if (closestResult) {
      paddedResults.push({
        ...closestResult,
        timestamp: currentTime // Normalize timestamp to grid
      });
    } else {
      paddedResults.push({
        timestamp: currentTime,
        alive: false,
        time: null,
        status: 'unknown'
      });
    }

    currentTime += intervalMs;
  }

  return paddedResults;
}

// Create or update chart - wrapped in try-catch to handle potential Chart.js errors
function createOrUpdateChart(ip, chartCanvas, labels, data, existingChart = null) {
  if (!chartCanvas) {
    console.error(`Chart canvas not found for ${ip}`);
    return false;
  }
  
  try {
    // If we have an existing chart for this IP, update it
    if (charts[ip]) {
      try {
        charts[ip].data.labels = labels;
        charts[ip].data.datasets[0].data = data;
        // Update Y-axis max to use the global max
        charts[ip].options.scales.y.max = globalMaxPingTime;
        charts[ip].update('none'); // Use 'none' animation for updates during sorting
        return true;
      } catch (updateError) {
        console.error(`Error updating existing chart for ${ip}:`, updateError);
        // If update fails, we'll create a new chart below
        delete charts[ip];
      }
    }
    
    // Try to reuse existing chart configuration if provided
    if (!charts[ip] && existingChart) {
      try {
        // Clean up any previous chart on this canvas
        const ctx = chartCanvas.getContext('2d');
        ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        
        const newChart = new Chart(chartCanvas, {
          type: existingChart.config.type,
          data: {
            labels: labels,
            datasets: [{
              label: 'Response Time (ms)',
              data: data,
              borderColor: 'rgba(52, 152, 219, 1)',
              backgroundColor: 'rgba(52, 152, 219, 0.2)',
              borderWidth: 2,
              tension: 0.3,
              spanGaps: true,
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
              duration: 0, // No animation during sorting
            },
            scales: {
              y: {
                beginAtZero: true,
                max: globalMaxPingTime,
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
        
        charts[ip] = newChart;
        return true;
      } catch (reuseError) {
        console.error(`Error reusing chart config for ${ip}:`, reuseError);
        // Fall through to create new chart from scratch
      }
    }
    
    // Create new chart if needed
    if (!charts[ip]) {
      try {
        // Clean up any previous chart on this canvas
        const ctx = chartCanvas.getContext('2d');
        ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        
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
              spanGaps: true,
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
              duration: 0, // No animation during sorting
            },
            scales: {
              y: {
                beginAtZero: true,
                max: globalMaxPingTime,
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
        return true;
      } catch (createError) {
        console.error(`Error creating new chart for ${ip}:`, createError);
      }
    }
    return false;
  } catch (error) {
    console.error(`Error creating/updating chart for ${ip}:`, error);
    
    // Try to show a simple fallback in case of error
    if (chartCanvas && chartCanvas.parentElement) {
      chartCanvas.parentElement.innerHTML = `
        <div class="chart-fallback">
          <div class="fallback-message">
            <p>Chart rendering error. Please try refreshing the page.</p>
            <p class="fallback-data">${data.length} data points collected</p>
            <p class="fallback-status">Latest status: ${data.length > 0 ? (data[data.length-1] === null ? 'Error' : 'OK') : 'Unknown'}</p>
          </div>
        </div>
      `;
    }
    
    return false;
  }
}

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
  
  // DOM elements
  const addTargetForm = document.getElementById('add-target-form');
  const discoverForm = document.getElementById('discover-form');
  targetsList = document.getElementById('targets-list');
  graphsContainer = document.getElementById('graphs');
  targetsCounter = document.getElementById('targets-counter');
  const pingTimerValue = document.getElementById('ping-timer-value');
  const headerRight = document.querySelector('.header-right');
  
  // Sort state - removed variables for sort method and direction
  
  // Add turbo mode toggle to the header
  if (headerRight) {
    const turboModeContainer = document.createElement('div');
    turboModeContainer.className = 'turbo-mode-container';
    
    const turboModeCheckbox = document.createElement('input');
    turboModeCheckbox.type = 'checkbox';
    turboModeCheckbox.id = 'turbo-mode-toggle';
    turboModeCheckbox.className = 'turbo-mode-checkbox';
    
    const turboModeLabel = document.createElement('label');
    turboModeLabel.htmlFor = 'turbo-mode-toggle';
    turboModeLabel.className = 'turbo-mode-label';
    turboModeLabel.textContent = 'Turbo Mode';
    
    turboModeContainer.appendChild(turboModeCheckbox);
    turboModeContainer.appendChild(turboModeLabel);
    
    headerRight.insertBefore(turboModeContainer, headerRight.firstChild);
    
    // Add event listener for turbo mode toggle
    turboModeCheckbox.addEventListener('change', handleTurboModeToggle);
  }
  
  const turboModeToggle = document.getElementById('turbo-mode-toggle');
  const turboModeContainer = document.querySelector('.turbo-mode-container');
  
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
  
  // Remove stagger animation for initial load to prevent blinking
  const graphAnimation = {
    opacity: [0, 1],
    translateY: [20, 0],
    duration: 500,
    easing: 'easeOutCubic'
  };
  
  // Run initial animations - only animate header, not graphs
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

  // Time interval selector event listener
  const timeIntervalSelect = document.getElementById('time-interval');
  if (timeIntervalSelect) {
    // Set initial value from the dropdown
    selectedTimeInterval = parseInt(timeIntervalSelect.value);

    timeIntervalSelect.addEventListener('change', (e) => {
      selectedTimeInterval = parseInt(e.target.value);
      console.log(`Time interval changed to ${selectedTimeInterval} minutes`);

      // Reload all graphs with the new time interval
      loadTargets().catch(err => {
        console.error('Error reloading targets after time interval change:', err);
      });
    });
  }

  // View mode selector event listener
  const viewModeSelect = document.getElementById('view-mode');
  const dashboardContainer = document.querySelector('.dashboard-container');

  // Load saved view mode from localStorage
  const savedViewMode = localStorage.getItem('viewMode');
  if (savedViewMode && (savedViewMode === 'classic' || savedViewMode === 'dense')) {
    currentViewMode = savedViewMode;
    if (viewModeSelect) {
      viewModeSelect.value = savedViewMode;
    }
  }

  // Apply initial view mode
  if (currentViewMode === 'dense' && dashboardContainer) {
    dashboardContainer.classList.add('dense-view');
  }

  if (viewModeSelect) {
    viewModeSelect.addEventListener('change', (e) => {
      const newViewMode = e.target.value;
      currentViewMode = newViewMode;

      console.log(`View mode changed to ${newViewMode}`);

      // Save to localStorage
      localStorage.setItem('viewMode', newViewMode);

      // Apply or remove dense-view class
      if (dashboardContainer) {
        if (newViewMode === 'dense') {
          dashboardContainer.classList.add('dense-view');
        } else {
          dashboardContainer.classList.remove('dense-view');
        }
      }

      // Trigger a small animation to indicate the change
      if (graphsContainer) {
        anime({
          targets: '.graph-container',
          scale: [0.98, 1],
          opacity: [0.7, 1],
          duration: 300,
          easing: 'easeOutCubic',
          delay: anime.stagger(20)
        });
      }
    });
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
  
  // Function to enter fullscreen mode for a specific graph
  function enterFullscreen(ip) {
    if (currentFullscreenGraph) return; // Already in fullscreen mode
    
    console.log(`Entering fullscreen for ${ip}`);
    
    // Find the graph container
    const graphId = `graph-${ip.replace(/\./g, '-')}`;
    const graphContainer = document.getElementById(graphId);
    
    if (graphContainer) {
      // Get content to show in fullscreen
      const chartContainer = graphContainer.querySelector('.chart-container');
      const header = graphContainer.querySelector('.graph-header');
      
      if (chartContainer && header) {
        currentFullscreenGraph = {
          ip: ip,
          chartId: chartContainer.querySelector('canvas').id
        };
        
        // Create fullscreen container
        const fullscreenContainer = document.createElement('div');
        fullscreenContainer.className = 'fullscreen-graph';
        fullscreenContainer.innerHTML = `
          <div class="fullscreen-header">
            <h2>${header.querySelector('h3').innerHTML}</h2>
            <button class="exit-fullscreen">
              <span>Exit Fullscreen (or press ESC)</span>
            </button>
          </div>
          <div class="fullscreen-chart-container">
            <canvas id="fullscreen-canvas"></canvas>
          </div>
        `;
        
        document.body.appendChild(fullscreenContainer);
        
        // Add event listener to exit button
        const exitButton = fullscreenContainer.querySelector('.exit-fullscreen');
        exitButton.addEventListener('click', () => {
          fullscreenContainer.remove();
          currentFullscreenGraph = null;
        });
        
        // Copy the chart to fullscreen canvas
        const canvas = chartContainer.querySelector('canvas');
        const fullscreenCanvas = fullscreenContainer.querySelector('canvas');
        
        if (canvas && fullscreenCanvas && charts[ip]) {
          // Clone the chart configuration
          const chart = charts[ip];
          const newChart = new Chart(fullscreenCanvas, {
            type: chart.config.type,
            data: {
              labels: [...chart.data.labels],
              datasets: [{
                ...chart.data.datasets[0],
                data: [...chart.data.datasets[0].data]
              }]
            },
            options: {
              ...chart.config.options,
              responsive: true,
              maintainAspectRatio: false,
              animation: {
                duration: 0
              },
              plugins: {
                ...chart.config.options.plugins,
                legend: {
                  display: true, // Show legend in fullscreen
                  position: 'top',
                  labels: {
                    color: 'rgba(255, 255, 255, 0.8)',
                    font: {
                      size: 14
                    }
                  }
                }
              }
            }
          });
        }
      }
    }
  }
  
  // Function to exit fullscreen mode
  function exitFullscreen() {
    const fullscreenContainer = document.querySelector('.fullscreen-graph');
    if (fullscreenContainer) {
      fullscreenContainer.remove();
      currentFullscreenGraph = null;
    }
  }
  
  // Add global event listener for keypresses
  document.addEventListener('keydown', function(e) {
    // Handle ESC key press to exit fullscreen
    if (e.key === 'Escape' && currentFullscreenGraph) {
      exitFullscreen();
    }
  });
  
  // Add click handler for graph containers (event delegation)
  document.body.addEventListener('click', function(e) {
    // Handle dropdown toggle
    if (e.target.closest('.dropdown-toggle')) {
      const dropdown = e.target.closest('.dropdown');
      if (dropdown) {
        const menu = dropdown.querySelector('.dropdown-menu');
        if (menu) {
          menu.classList.toggle('show');
          
          // Close other open menus
          document.querySelectorAll('.dropdown-menu.show').forEach(openMenu => {
            if (openMenu !== menu) {
              openMenu.classList.remove('show');
            }
          });
          
          e.stopPropagation();
        }
      }
    }
    
    // Handle dropdown menu item clicks
    if (e.target.closest('.dropdown-item')) {
      const item = e.target.closest('.dropdown-item');
      const action = item.dataset.action;
      const ip = item.dataset.ip;
      
      if (action && ip) {
        // Perform the action
        switch (action) {
          case 'fullscreen':
            // Use the reusable enterFullscreen function
            enterFullscreen(ip);
            break;
          
          case 'reset':
            // Handle reset action
            console.log(`Reset data for ${ip}`);
            
            // Confirm before resetting
            if (confirm(`Are you sure you want to reset all ping data for ${ip}? This cannot be undone.`)) {
              fetch(`/api/targets/${ip}/reset`, {
                method: 'POST'
              })
              .then(response => {
                if (response.ok) {
                  // Show success notification
                  const notification = document.createElement('div');
                  notification.className = 'notification success';
                  notification.textContent = `Reset data for ${ip}`;
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
                  
                  // Update the graph with empty data
                  updateGraphData(ip);
                } else {
                  console.error('Failed to reset data');
                  alert('Failed to reset data. Please try again.');
                }
              })
              .catch(error => {
                console.error('Error resetting data:', error);
                alert('Error resetting data. Please try again.');
              });
            }
            break;
            
          case 'remove':
            // Handle remove action
            console.log(`Remove ${ip}`);
            
            // Confirm before removing
            if (confirm(`Are you sure you want to remove ${ip} from monitoring?`)) {
              fetch(`/api/targets/${ip}`, {
                method: 'DELETE'
              })
              .then(response => {
                if (response.ok) {
                  // Show success notification
                  const notification = document.createElement('div');
                  notification.className = 'notification success';
                  notification.textContent = `Removed ${ip} from monitoring`;
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
                  
                  // Remove from DOM
                  const graphId = `graph-${ip.replace(/\./g, '-')}`;
                  const graphContainer = document.getElementById(graphId);
                  
                  if (graphContainer) {
                    // Add animation for removal
                    anime({
                      targets: graphContainer,
                      opacity: 0,
                      height: 0,
                      marginBottom: 0,
                      paddingTop: 0,
                      paddingBottom: 0,
                      duration: 300,
                      easing: 'easeOutCubic',
                      complete: function() {
                        graphContainer.remove();
                        
                        // Update counter
                        let currentCount = parseInt(targetsCounter.textContent) || 0;
                        targetsCounter.textContent = Math.max(0, currentCount - 1);
                        
                        // Clear the chart from memory
                        if (charts[ip]) {
                          charts[ip].destroy();
                          delete charts[ip];
                        }
                      }
                    });
                  }
                } else {
                  console.error('Failed to remove target');
                  alert('Failed to remove target. Please try again.');
                }
              })
              .catch(error => {
                console.error('Error removing target:', error);
                alert('Error removing target. Please try again.');
              });
            }
            break;
        }
        
        // Close the dropdown
        const dropdown = item.closest('.dropdown');
        if (dropdown) {
          const menu = dropdown.querySelector('.dropdown-menu');
          if (menu) {
            menu.classList.remove('show');
          }
        }
      }
    }
    
    // Check if click was on graph container but not on dropdown or buttons
    const graphContainer = e.target.closest('.graph-container');
    if (graphContainer && 
        !e.target.closest('.dropdown') && 
        !e.target.closest('button') &&
        !e.target.closest('.dropdown-menu')) {
      
      const ip = graphContainer.id.replace('graph-', '').replace(/-/g, '.');
      
      // Toggle fullscreen for this graph
      if (!currentFullscreenGraph) {
        // Use the reusable enterFullscreen function
        enterFullscreen(ip);
      }
    }
    
    // Close dropdown menus when clicking outside
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
        menu.classList.remove('show');
      });
    }
  });
  
  // Sync with server and start timer
  async function syncWithServerAndStartTimer() {
    try {
      // Get ping status from server
      const response = await fetch('/api/ping/status');
      const data = await response.json();
      
      // Update isTurboMode based on server status
      isTurboMode = data.turboMode;
      
      // Update UI for turbo mode toggle
      const turboModeCheckbox = document.getElementById('turbo-mode-toggle');
      if (turboModeCheckbox) {
        turboModeCheckbox.checked = isTurboMode;
        
        // Update the container class to show active state
        const container = document.querySelector('.turbo-mode-container');
        if (container) {
          if (isTurboMode) {
            container.classList.add('active');
          } else {
            container.classList.remove('active');
          }
        }
      }
      
      // Force clear any existing timer to ensure clean restart
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      
      // Get the expected full interval based on turbo mode state
      const fullInterval = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
      
      // Use server data if available to get accurate time until next ping
      if (data.secondsUntilNextPing !== undefined) {
        // The server's secondsUntilNextPing already accounts for ping duration
        // because it calculates based on the next scheduled ping time
        nextPingIn = data.secondsUntilNextPing;
        
        console.log(`Using server timing: ${nextPingIn}s until next ping (${isTurboMode ? 'turbo' : 'normal'} mode active)`);
        
        // Add logging to help debug timing issues
        if (data.lastPingTime) {
          const lastPingTime = new Date(data.lastPingTime);
          const now = new Date();
          const elapsedSinceLastPing = Math.round((now - lastPingTime) / 1000);
          console.log(`Last ping was ${elapsedSinceLastPing}s ago, next ping in ${nextPingIn}s, full cycle: ${fullInterval}s`);
        }
      } else {
        // No server data, use the full interval
        nextPingIn = fullInterval;
        console.log(`No server timing data, using full ${isTurboMode ? 'turbo' : 'normal'} interval: ${nextPingIn}s`);
      }
      
      // Always restart the timer to apply changes
      updateRefreshTimer();
    } catch (error) {
      console.error('Error syncing with server:', error);
      
      // Force clear any existing timer on error
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      
      // If we can't reach the server, use the full interval for current mode
      nextPingIn = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
      console.log(`Server connection failed, using full ${isTurboMode ? 'turbo' : 'normal'} interval: ${nextPingIn}s`);
      
      // Restart the timer
      updateRefreshTimer();
    }
  }
  
  // Re-sync with server every minute to prevent drift
  setInterval(syncWithServerAndStartTimer, 60 * 1000);
  
  // Global timer interval reference
  let timerInterval = null;
  
  // Update the refresh timer
  function updateRefreshTimer() {
    // Double-check we're clearing any existing timer
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    // Update the timer element with the current value
    if (pingTimerValue) {
      pingTimerValue.textContent = nextPingIn;
    }
    
    console.log(`Timer updated: ${nextPingIn}s until next ping (turbo mode: ${isTurboMode ? 'on' : 'off'})`);
    
    // Create a new interval that updates every second
    timerInterval = setInterval(() => {
      nextPingIn = Math.max(0, nextPingIn - 1);
      
      if (pingTimerValue) {
        pingTimerValue.textContent = nextPingIn;
      }
      
      // When timer reaches zero, refresh data and re-sync with server
      if (nextPingIn <= 0) {
        // Clear the interval immediately to prevent race conditions
        clearInterval(timerInterval);
        timerInterval = null;
        
        // Record start time of ping cycle
        const pingStartTime = Date.now();
        
        // Load targets to refresh data
        loadTargets()
          .then(() => {
            // Calculate how long the ping cycle took
            const pingDuration = Math.round((Date.now() - pingStartTime) / 1000);
            const fullInterval = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
            
            console.log(`Ping cycle completed in ${pingDuration}s`);
            
            // Sync with server, but adjust wait time based on ping duration
            syncWithServerAndStartTimer()
              .then(() => {
                // This is a fallback in case server doesn't provide accurate timing
                // It will adjust the nextPingIn based on how long the ping cycle took
                const fullInterval = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
                
                // If the time reported by server seems too long, adjust it
                if (nextPingIn > fullInterval - pingDuration) {
                  // Calculate the remaining wait time by subtracting the ping duration
                  // This ensures we maintain the desired interval between ping starts
                  const adjustedWait = Math.max(1, fullInterval - pingDuration);
                  console.log(`Adjusting wait time: ${nextPingIn}s → ${adjustedWait}s (cycle took ${pingDuration}s)`);
                  nextPingIn = adjustedWait;
                  
                  // Update the timer display
                  if (pingTimerValue) {
                    pingTimerValue.textContent = nextPingIn;
                  }
                  
                  // Restart the timer with adjusted time
                  updateRefreshTimer();
                }
              });
          })
          .catch(err => {
            console.error("Error during ping cycle:", err);
            // Ensure we always restart the timer even if there's an error
            syncWithServerAndStartTimer();
          });
      }
    }, 1000);
  }
  
  // Generate a Docker-style random host name with drinking-related adjectives
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
    
    // Generate a funny host name if none provided
    const hostName = nameInput.value || generateDrunkenHostName();
    
    const target = {
      ip: ipInput.value,
      name: hostName
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
        showModal('Error', `<p>${error.error || 'Another discovery is already in progress'}</p>
          <button class="primary-btn" id="ok-button">OK</button>
        `);
        // Add event listener to OK button
        document.getElementById('ok-button').addEventListener('click', closeModal);
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
            } else if (data.type === 'complete') {
              // Discovery complete
              showDiscoveryResults(discoveredHosts);
            } else if (data.type === 'error') {
              showModal('Error', `<p>Error: ${data.message}</p>
                <button class="primary-btn" id="ok-button">OK</button>
              `);
              // Add event listener to OK button
              document.getElementById('ok-button').addEventListener('click', closeModal);
            }
          } catch (e) {
            console.error('Error parsing JSON:', e, buffer);
            buffer = '';
          }
        }
      }
    } catch (error) {
      console.error('Error discovering hosts:', error);
      showModal('Error', `
        <p>Failed to discover hosts. Check console for details.</p>
        <button class="primary-btn" id="ok-button">OK</button>
      `);
      // Add event listener to OK button
      document.getElementById('ok-button').addEventListener('click', closeModal);
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
  
  // Show discovery results
  function showDiscoveryResults(hosts) {
    // Reset discovery state
    isDiscoveryRunning = false;
    
    if (hosts.length === 0) {
      showModal('Discovery Results', `
        <p>No hosts found in the specified range.</p>
        <div class="modal-actions">
          <button id="ok-button" class="primary-btn">OK</button>
        </div>
      `);
      
      // Add event listener to OK button
      document.getElementById('ok-button').addEventListener('click', closeModal);
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
        <button id="ok-button" class="primary-btn">OK</button>
      </div>`;
    
    showModal('Discovery Results', hostsHtml);
    
    // Add event listener to OK button
    const okButton = document.getElementById('ok-button');
    if (okButton) {
      okButton.addEventListener('click', () => {
        closeModal();
        // Refresh the targets list to show the newly added hosts
        loadTargets();
      });
    } else {
      console.error('OK button not found in discovery results modal');
    }
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
    
    // Add specific styling to ensure primary buttons are visible
    const primaryButtons = modal.querySelectorAll('.primary-btn');
    primaryButtons.forEach(button => {
      if (button.style.display === 'none') {
        console.warn('Found a hidden primary button, making it visible');
        button.style.display = 'inline-block';
      }
      
      // Ensure button has proper styling
      button.style.backgroundColor = '#2ecc71';
      button.style.color = 'white';
      button.style.padding = '8px 15px';
      button.style.borderRadius = '6px';
      button.style.cursor = 'pointer';
      button.style.border = 'none';
      button.style.marginTop = '10px';
    });
    
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
  
  // Handle turbo mode toggle
  function handleTurboModeToggle(e) {
    console.log("Toggle turbo mode clicked");
    const turboSwitch = document.getElementById('turbo-mode-toggle');
    if (!turboSwitch) return;
    
    const enabled = turboSwitch.checked;
    
    // Show a loading indicator on the checkbox container
    const container = document.querySelector('.turbo-mode-container');
    if (container) {
      container.classList.add('loading');
      
      // Update container class immediately for better UI feedback
      if (enabled) {
        container.classList.add('active');
      } else {
        container.classList.remove('active');
      }
    }
    
    // Update the local state immediately to prevent timer from using the wrong mode
    isTurboMode = enabled;
    
    // If there's an existing timer, clear it to prevent conflicts
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    // Immediately update the timer display to give instant feedback
    const pingTimerValue = document.getElementById('ping-timer-value');
    if (pingTimerValue) {
      // Set to the expected interval based on the new toggle state
      nextPingIn = enabled ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
      pingTimerValue.textContent = nextPingIn;
      
      // Apply a quick visual effect to indicate the change
      anime({
        targets: pingTimerValue,
        scale: [1, 1.2, 1],
        opacity: [1, 0.7, 1],
        duration: 300,
        easing: 'easeInOutElastic(1, .6)'
      });
      
      // Start a new timer with the updated interval right away
      updateRefreshTimer();
    }
    
    // Record start time to measure API response time
    const startTime = Date.now();
    
    fetch('/api/ping/turbo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled })
    })
    .then(response => response.json())
    .then(data => {
      // Calculate how long the API call took
      const apiCallDuration = Math.round((Date.now() - startTime) / 1000);
      console.log(`Turbo mode toggle API call took ${apiCallDuration}s`);
      console.log("Turbo mode response:", data);
      
      // Remove loading indicator
      if (container) {
        container.classList.remove('loading');
      }
      
      if (data.success) {
        // We already updated isTurboMode, but confirm it matches the server response
        if (isTurboMode !== enabled) {
          console.warn("Local turbo mode state out of sync with server response");
          isTurboMode = enabled;
        }
        
        // The API call includes an immediate ping, so we need to account for 
        // the time it took in our timer calculations
        const fullInterval = enabled ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
        
        if (data.pingStatus) {
          // The server's reported time already accounts for the ping execution time
          nextPingIn = data.pingStatus.secondsUntilNextPing;
          
          console.log(`Server reports next ping in ${nextPingIn}s (${enabled ? 'turbo' : 'normal'} mode)`);
          
          // Add logging to help debug timing issues
          if (data.pingStatus.lastPingTime) {
            const lastPingTime = new Date(data.lastPingTime);
            const now = new Date();
            const elapsedSinceLastPing = Math.round((now - lastPingTime) / 1000);
            console.log(`Last ping was ${elapsedSinceLastPing}s ago, next ping in ${nextPingIn}s, full cycle: ${fullInterval}s`);
          }
          
          // Update the timer display with the server-provided time
          if (pingTimerValue) {
            pingTimerValue.textContent = nextPingIn;
          }
          
          // Restart the timer with the updated value from server
          updateRefreshTimer();
        }
        
        // Show notification
        const notification = document.createElement('div');
        notification.className = `notification ${enabled ? 'success' : 'info'}`;
        notification.textContent = `Turbo mode ${enabled ? 'enabled' : 'disabled'} - ${enabled ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL}s cycle`;
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
      } else {
        // If there was an error, revert all changes to match previous state
        isTurboMode = !enabled;
        turboSwitch.checked = !enabled;
        
        // Revert the timer
        nextPingIn = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
        if (pingTimerValue) {
          pingTimerValue.textContent = nextPingIn;
        }
        
        // Update container style
        if (container) {
          if (isTurboMode) {
            container.classList.add('active');
          } else {
            container.classList.remove('active');
          }
        }
        
        // Restart the timer with the reverted values
        updateRefreshTimer();
        
        // Show error notification
        const notification = document.createElement('div');
        notification.className = 'notification danger';
        notification.textContent = `Error: ${data.message || 'Failed to change turbo mode'}`;
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
      }
    })
    .catch(error => {
      console.error('Error toggling turbo mode:', error);
      
      // Remove loading indicator
      if (container) {
        container.classList.remove('loading');
      }
      
      // Revert all changes on error
      isTurboMode = !enabled;
      turboSwitch.checked = !enabled;
      
      // Revert the timer
      nextPingIn = isTurboMode ? TURBO_MODE_INTERVAL : DEFAULT_PING_INTERVAL;
      if (pingTimerValue) {
        pingTimerValue.textContent = nextPingIn;
      }
      
      // Update container style
      if (container) {
        if (isTurboMode) {
          container.classList.add('active');
        } else {
          container.classList.remove('active');
        }
      }
      
      // Restart the timer with the reverted values
      updateRefreshTimer();
      
      // Show error notification
      const notification = document.createElement('div');
      notification.className = 'notification danger';
      notification.textContent = 'Error connecting to server. Failed to change turbo mode.';
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
    });
  }
  
  // Initialize the application
  // First sync with server to get current ping status
  syncWithServerAndStartTimer();
  
  // Then load targets once
  loadTargets();
  
  // Setup event listeners
  if (addTargetForm) {
    addTargetForm.addEventListener('submit', handleAddTarget);
  }
  
  if (discoverForm) {
    discoverForm.addEventListener('submit', handleDiscoverHosts);
  }
  
  // Setup periodic sync with server (every 5 minutes)
  setInterval(syncWithServerAndStartTimer, 5 * 60 * 1000);
}); 

// Render targets list
function renderTargets(targets) {
  if (!targetsList) return;
  
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

// Render a graph for a target
function renderGraph(ip, results, targetName, existingChart = null) {
  try {
    // Format the IP to use as an ID
    const graphId = `graph-${ip.replace(/\./g, '-')}`;
    const chartId = `chart-${graphId}`;
    
    // Check if this graph already exists
    let graphContainer = document.getElementById(graphId);
    let status = 'unknown';
    
    // Get latest status from results if available
    if (results.length > 0) {
      const latestResult = results[results.length - 1];
      status = latestResult.status || 'unknown';
    }
    
    // If the graph doesn't exist, create it
    if (!graphContainer) {
      // Create graph container
      graphContainer = document.createElement('div');
      graphContainer.id = graphId;
      graphContainer.className = 'graph-container';
      graphContainer.style.opacity = 1; // Start with full opacity to prevent blinking
      graphContainer.dataset.ip = ip;
      graphContainer.dataset.status = status;
      
      // Use the provided name or find a target name for this IP
      let displayName = targetName || ip;
      
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
          <canvas id="${chartId}"></canvas>
        </div>
      `;
      
      // Append to DOM
      if (graphsContainer) {
        graphsContainer.appendChild(graphContainer);
        
        // Only animate new graphs if this is not the initial load
        if (!isInitialLoad) {
          if (typeof anime !== 'undefined') {
            anime({
              targets: graphContainer,
              opacity: [0, 1],
              translateY: [20, 0],
              duration: 500,
              easing: 'easeOutCubic',
              delay: 0 // No delay between graphs
            });
          }
        }
      }
    } else {
      // Update the status if we have new results
      if (results.length > 0) {
        const statusSpan = graphContainer.querySelector('.graph-status');
        const latestResult = results[results.length - 1];
        const newStatus = latestResult.status || 'unknown';
        
        if (statusSpan) {
          // Update status text and class if needed
          if (statusSpan.textContent !== newStatus) {
            statusSpan.textContent = newStatus;
            statusSpan.className = `graph-status ${newStatus}`;
            
            // Update dataset attribute for sorting
            graphContainer.dataset.status = newStatus;
            
            // Apply pulse animation to chart container when status changes
            const chartContainer = graphContainer.querySelector('.chart-container');
            if (chartContainer) {
              // Remove any existing pulse classes
              chartContainer.classList.remove('chart-pulse-green', 'chart-pulse-red');
              
              // Force a reflow to ensure animation runs again
              void chartContainer.offsetWidth;
              
              // Add the appropriate pulse class based on status
              if (newStatus === 'green') {
                chartContainer.classList.add('chart-pulse-green');
              } else if (newStatus === 'red') {
                chartContainer.classList.add('chart-pulse-red');
              }
            }
          }
        }
      }
    }
    
    // Get the chart canvas element
    const chartCanvas = document.getElementById(chartId);

    // Filter and pad results based on selected time interval
    const processedResults = filterAndPadResults(results, selectedTimeInterval);

    // Prepare data for the chart
    const labels = processedResults.map(result => {
      const date = new Date(result.timestamp);
      // Use a more compact time format based on data density
      return formatTimeCompact(date, processedResults.length);
    });

    const data = processedResults.map(result => result.time || null);
    
    // Create or update the chart if canvas is available
    if (chartCanvas) {
      createOrUpdateChart(ip, chartCanvas, labels, data, existingChart);
      
      // Apply pulse animation to chart container when data is loaded/updated
      // But only if we have real results and not just creating an empty chart
      if (results.length > 0 && !isInitialLoad) {
        const chartContainer = graphContainer.querySelector('.chart-container');
        if (chartContainer) {
          // Remove any existing pulse classes
          chartContainer.classList.remove('chart-pulse-green', 'chart-pulse-red');
          
          // Force a reflow to ensure animation runs again
          void chartContainer.offsetWidth;
          
          // Add the appropriate pulse class based on the latest status
          const latestResult = results[results.length - 1];
          const status = latestResult.status || 'unknown';
          
          if (status === 'green') {
            chartContainer.classList.add('chart-pulse-green');
          } else if (status === 'red') {
            chartContainer.classList.add('chart-pulse-red');
          }
        }
      }
    } else {
      console.error(`Canvas element not found for ${ip}`);
    }
  } catch (error) {
    console.error(`Error rendering graph for ${ip}:`, error);
  }
}

// Update loadTargets to return a promise and track duration
async function loadTargets() {
  const startTime = Date.now();

  try {
    const response = await fetch('/api/targets');
    let targets = await response.json();

    // Sort targets by IP
    targets = sortTargets(targets);

    // Store chart references before rebuilding
    const existingCharts = {...charts};

    // Update targets counter
    targetsCounter.textContent = targets.length;

    // Clear the targets list and rebuild it
    renderTargets(targets);

    // First pass: load all results and calculate global max ping time
    const allResults = [];
    for (const target of targets) {
      try {
        const resultsResponse = await fetch(`/api/results/${target.ip}?limit=100`);
        const results = await resultsResponse.json();
        allResults.push({ target, results });
      } catch (error) {
        console.error(`Error loading ping results for ${target.ip}:`, error);
        allResults.push({ target, results: [] });
      }
    }

    // Calculate global max ping time across all targets (with filtered data)
    let maxPing = 100; // Default minimum of 100ms
    for (const { results } of allResults) {
      const processedResults = filterAndPadResults(results, selectedTimeInterval);
      for (const result of processedResults) {
        if (result.time !== null && result.time > maxPing) {
          maxPing = result.time;
        }
      }
    }

    // Add 10% padding to the max for better visualization
    globalMaxPingTime = Math.ceil(maxPing * 1.1);
    console.log(`Global max ping time set to ${globalMaxPingTime}ms (actual max: ${maxPing}ms)`);

    // Second pass: render all graphs with the same Y-axis scale
    for (const { target, results } of allResults) {
      try {
        // Use existing chart if available
        renderGraph(target.ip, results, target.name, existingCharts[target.ip]);
      } catch (error) {
        console.error(`Error rendering graph for ${target.ip}:`, error);
        // Still render with empty data if there's an error
        renderGraph(target.ip, [], target.name, existingCharts[target.ip]);
      }
    }

    // After first load, set initial load flag to false
    isInitialLoad = false;

    // Log how long it took to load and render everything
    const duration = (Date.now() - startTime) / 1000;
    console.log(`Loaded and rendered ${targets.length} targets in ${duration.toFixed(2)}s`);

    return targets;
  } catch (error) {
    console.error('Error loading targets:', error);
    throw error;
  }
}

// Create a function to update graph data without recreating the entire graph
async function updateGraphData(ip, name) {
  try {
    const response = await fetch(`/api/results/${ip}?limit=100`);
    const results = await response.json();
    
    // Find the existing graph
    const graphId = `graph-${ip.replace(/\./g, '-')}`;
    const chartId = `chart-${graphId}`;
    const graphContainer = document.getElementById(graphId);
    
    if (graphContainer && charts[ip]) {
      // Filter and pad results based on selected time interval
      const processedResults = filterAndPadResults(results, selectedTimeInterval);

      // Map the data for the chart
      const labels = processedResults.map(result => {
        const date = new Date(result.timestamp);
        return formatTimeCompact(date, processedResults.length);
      });

      const data = processedResults.map(result => result.time || null);
      
      // Update the chart with new data
      const chartCanvas = document.getElementById(chartId);
      if (chartCanvas) {
        createOrUpdateChart(ip, chartCanvas, labels, data, charts[ip]);
        
        // Update the status display
        if (results.length > 0) {
          const latestResult = results[results.length - 1];
          const status = latestResult.status || 'unknown';
          
          const statusSpan = graphContainer.querySelector('.graph-status');
          if (statusSpan && statusSpan.textContent !== status) {
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
      } else {
        // If the chart doesn't exist, we need to create it via loadPingResults
        loadPingResults(ip, name);
      }
    } else {
      // If the chart doesn't exist, we need to create it via loadPingResults
      loadPingResults(ip, name);
    }
  } catch (error) {
    console.error(`Error updating data for ${ip}:`, error);
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