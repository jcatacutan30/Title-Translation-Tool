// ============================================
// SESSION PERSISTENCE
// ============================================
function saveSession() {
  const session = {
    batchInput: document.getElementById('batchInput').value,
    pastedData: document.getElementById('pastedData').value,
    lastBatchResults: window._lastBatchResults || null,
    activeTab: document.querySelector('.tab.active')?.dataset.tab || 'batch',
  };
  localStorage.setItem('translatorSession', JSON.stringify(session));
}

function restoreSession() {
  const raw = localStorage.getItem('translatorSession');
  if (!raw) return;

  try {
    const session = JSON.parse(raw);
    // Only prompt if there's meaningful data to restore
    if (!session.pastedData && !session.lastBatchResults) return;

    if (!confirm('Restore previous session?')) {
      localStorage.removeItem('translatorSession');
      return;
    }

    // Restore active tab
    if (session.activeTab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tab = document.querySelector(`.tab[data-tab="${session.activeTab}"]`);
      if (tab) tab.classList.add('active');
      const content = document.getElementById(`${session.activeTab}-tab`);
      if (content) content.classList.add('active');
    }

    // Restore batch input
    if (session.batchInput) {
      document.getElementById('batchInput').value = session.batchInput;
    }

    // Restore pasted table rows
    if (session.pastedData) {
      renderTableRows(session.pastedData);
    }

    // Restore translated results
    if (session.lastBatchResults) {
      window._lastBatchResults = session.lastBatchResults;
      displayBatchResults(session.lastBatchResults);
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Remove active from all tabs and contents
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Add active to clicked tab and corresponding content
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    saveSession();
  });
});

// ============================================
// BATCH PROCESSING (Paste Mode)
// ============================================
// ============================================
// BATCH PROCESSING (Table Paste Mode)
// ============================================

// Paste handling
const pasteTable = document.getElementById('pasteTable');
const pasteBody = document.getElementById('pasteBody');
const pastedDataInput = document.getElementById('pastedData');

// Focus table container when clicked
document.querySelector('.table-container').addEventListener('click', (e) => {
  if (e.target.tagName !== 'TD' && e.target.tagName !== 'BUTTON') {
    // If clicking empty space, focus the last valid cell or just verify focus
  }
});

// Handle paste event
document.addEventListener('paste', (e) => {
  // Only intercept if we are inside the table container or the body (and not in other inputs)
  if (!e.target.closest('.table-container') && document.activeElement.tagName !== 'BODY') return;

  e.preventDefault();

  const clipboardData = e.clipboardData || window.clipboardData;
  const pastedText = clipboardData.getData('text/plain');

  if (!pastedText) return;

  renderTableRows(pastedText);
});

function renderTableRows(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return;

  // Append to existing content (don't clear)
  // pasteBody.innerHTML = '';

  // Variables to track values for fill-down
  let lastBatch = '';
  let lastLineup = '';

  // Check if there are existing rows to inherit from
  const existingRows = pasteBody.querySelectorAll('.data-row');
  if (existingRows.length > 0) {
    const lastRow = existingRows[existingRows.length - 1];
    const cells = lastRow.querySelectorAll('td');
    if (cells.length >= 2) {
      lastBatch = cells[0].textContent.trim();
      lastLineup = cells[1].textContent.trim();
    }
  }

  lines.forEach((line, index) => {
    const columns = line.split('\t');
    if (columns.length < 2) return; // Skip empty/invalid rows

    // Handle Fill Down for Batch (0) and Lineup (1)
    let batch = columns[0]?.trim() || '';
    if (batch) {
      lastBatch = batch;
    } else {
      batch = lastBatch;
    }

    let lineup = columns[1]?.trim() || '';
    if (lineup) {
      lastLineup = lineup;
    } else {
      lineup = lastLineup;
    }

    const tr = document.createElement('tr');
    tr.className = 'data-row';

    // Construct row data with filled values
    // Index: 0:Batch, 1:Lineup, 2:Design, 3:Designer, 4:Family, 5:DesignCode, 6:Label
    const rowData = [
      batch,
      lineup,
      columns[2]?.trim() || '',
      columns[3]?.trim() || '',
      columns[4]?.trim() || '',
      columns[5]?.trim() || '',
      columns[6]?.trim() || ''
    ];

    // Create cells
    rowData.forEach(text => {
      const td = document.createElement('td');
      td.contentEditable = true;
      td.textContent = text;
      tr.appendChild(td);
    });

    // Action column (Delete button)
    const actionTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Remove row';
    deleteBtn.onclick = () => {
      tr.remove();
      updateHiddenInput();
    };
    actionTd.appendChild(deleteBtn);
    tr.appendChild(actionTd);

    pasteBody.appendChild(tr);
  });

  // Update hidden input with the fully populated data
  updateHiddenInput();
}

function updateHiddenInput() {
  // Reconstruct tab-separated string from table rows
  const rows = Array.from(pasteBody.querySelectorAll('.data-row'));
  const text = rows.map(row => {
    const cells = Array.from(row.querySelectorAll('td[contenteditable]'));
    return cells.map(cell => cell.textContent.trim()).join('\t');
  }).join('\n');
  pastedDataInput.value = text;
  saveSession();
}

// Observe changes in table to update hidden input
pasteBody.addEventListener('input', () => {
  updateHiddenInput();
});

document.getElementById('batchForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const batchInput = document.getElementById('batchInput').value.trim();
  // Ensure hidden input is up to date
  updateHiddenInput();
  const pastedData = pastedDataInput.value.trim();

  if (!pastedData) {
    alert('Please paste data from the source sheet into the table');
    return;
  }

  const loading = document.getElementById('batchLoading');
  const error = document.getElementById('batchError');
  const submitBtn = document.getElementById('batchSubmitBtn');
  const combinedOutput = document.getElementById('combinedOutput');
  const duplicateAlerts = document.getElementById('duplicateAlerts');

  // Show loading, hide previous results
  loading.classList.remove('hidden');
  error.classList.add('hidden');
  combinedOutput.classList.add('hidden');
  duplicateAlerts.classList.add('hidden');
  submitBtn.disabled = true;

  try {
    const response = await fetch('/api/process-paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchInput, pastedData: pastedData }),
    });

    if (!response.ok) {
      let errMsg = 'Batch processing failed';
      try {
        const err = await response.json();
        errMsg = err.error || errMsg;
      } catch (e) {
        errMsg = `Server error (${response.status})`;
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    window._lastBatchResults = data;
    displayBatchResults(data);
    saveSession();
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    submitBtn.disabled = false;
  }
});

// Render output table
// Render output table
function renderOutputTable(tableId, rows) {
  const table = document.getElementById(tableId);
  if (!rows || rows.length === 0) return;

  table.innerHTML = '';
  const headerRow = document.createElement('tr');

  // Headers (30 columns)
  const headers = [
    'Design Code', 'Lineup Name (EN)', '',
    'Family (DE)', '', 'Family (IT)', '', 'Family (FR)', '', 'Family (PL)', '',
    'Family (NL)', '', 'Family (SE)', '', 'Family (ES)', '', 'Family (JP)', '',
    '', // Col 20 Empty
    'Design Name (EN)',
    'Name (DE)', 'Name (IT)', 'Name (FR)', 'Name (PL)', 'Name (NL)', 'Name (SE)', 'Name (ES)', 'Name (JP)',
    '' // Col 30 Empty
  ];

  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  rows.forEach(item => {
    const tr = document.createElement('tr');

    if (item.isHeader) {
      tr.className = 'section-header-row';

      const td = document.createElement('td');
      td.colSpan = 30;
      td.textContent = item.row[0];
      tr.appendChild(td);
    } else {
      // Check if item.row exists, otherwise it might be the item itself if legacy format
      const cellData = item.row || item;

      if (Array.isArray(cellData)) {
        cellData.forEach(cellText => {
          const td = document.createElement('td');
          td.textContent = cellText;
          tr.appendChild(td);
        });
      }
    }

    table.appendChild(tr);
  });
}

function displayBatchResults(data) {
  // Show duplicate alerts if any
  if (data.duplicates && data.duplicates.length > 0) {
    const alertsDiv = document.getElementById('duplicateAlerts');
    const list = document.getElementById('duplicateList');
    list.innerHTML = data.duplicates.map(d =>
      `<li><strong>${d.code}</strong>: "${d.first}" vs "${d.duplicate}"</li>`
    ).join('');
    alertsDiv.classList.remove('hidden');
  }

  // Show Combined output
  if (data.rows && data.rows.length > 0) {
    document.getElementById('totalGroups').textContent = data.totalGroups;
    document.getElementById('outputHeaderInfo').textContent = data.headerString || '';

    // Update hidden textarea for copy
    document.getElementById('combinedOutputText').value = data.outputText;

    // Render Table
    renderOutputTable('combinedTable', data.rows);

    document.getElementById('combinedOutput').classList.remove('hidden');
  }
}

// Copy to clipboard handlers
document.getElementById('copyCombinedBtn').addEventListener('click', () => {
  const text = document.getElementById('combinedOutputText').value;
  copyToClipboard(text, 'copyCombinedBtn');
});

// Download XLSX handler
document.getElementById('downloadXlsxBtn').addEventListener('click', () => {
  const table = document.getElementById('combinedTable');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.table_to_sheet(table);
  XLSX.utils.book_append_sheet(wb, ws, 'Translations');

  const headerInfo = document.getElementById('outputHeaderInfo').textContent || 'translations';
  const filename = headerInfo.replace(/[^a-zA-Z0-9_\-#, ]/g, '').trim() || 'translations';
  XLSX.writeFile(wb, `${filename}.xlsx`);
});


async function copyToClipboard(text, btnId) {
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById(btnId);
    const originalText = btn.textContent;
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

// ============================================
// SINGLE TITLE TRANSLATION (existing)
// ============================================
document.getElementById('translateForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const title = document.getElementById('titleInput').value.trim();
  if (!title) return;

  const loading = document.getElementById('loading');
  const results = document.getElementById('results');
  const error = document.getElementById('error');
  const submitBtn = document.getElementById('submitBtn');

  // Show loading, hide previous results
  loading.classList.remove('hidden');
  results.classList.add('hidden');
  error.classList.add('hidden');
  submitBtn.disabled = true;

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Translation failed');
    }

    const data = await response.json();
    displayResults(data);
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    submitBtn.disabled = false;
  }
});

function displayResults(data) {
  const grid = document.getElementById('translationGrid');
  grid.innerHTML = '';

  // Original title card (full width, highlighted)
  const originalCard = createCard('EN (Original)', data.original);
  originalCard.classList.add('original');
  grid.appendChild(originalCard);

  // Translation cards
  const languages = {
    DE: 'German',
    IT: 'Italian',
    FR: 'French',
    PL: 'Polish',
    NL: 'Dutch',
    SE: 'Swedish',
    ES: 'Spanish',
    JP: 'Japanese',
  };

  for (const [code, name] of Object.entries(languages)) {
    grid.appendChild(createCard(`${code} (${name})`, data.translations[code]));
  }

  // Sheet status - Now just translation status
  const status = document.getElementById('sheetStatus');
  if (data.translations) {
    status.textContent = '✓ Translation ready';
    status.className = 'status-success';
  } else {
    status.textContent = '✗ Translation failed';
    status.className = 'status-error';
  }

  document.getElementById('results').classList.remove('hidden');
}

function createCard(label, text) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<strong>${label}</strong><p>${escapeHtml(text)}</p>`;
  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Restore previous session on page load
restoreSession();
