/**
 * BubbleScan AI™ Web Application Client
 * Complete Universal OMR Evaluation Suite, Visual Dossier & Dual CSV Manager
 */

(function () {
  'use strict';

  // ── State Management ──────────────────────────────────────────────────────
  const STATE = {
    activeTab: 'scanner',
    activeSetTab: 'SET 1',
    answerKeys: [
      {
        id: 'default_physics',
        name: 'Physics Semester Final',
        subject: 'PHY101',
        totalQuestions: 10,
        optionsPerQuestion: 6,
        marksPerQuestion: 3.0,
        penaltyPerWrong: 0.0,
        answers: [['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D']],
        setAnswers: {
          'SET 1': [['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D']],
          'SET 2': [['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E']],
          'SET 3': [['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F']],
          'SET 4': [['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A']],
          'SET 5': [['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B']],
          'SET 6': [['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C']],
        }
      }
    ],
    selectedKeyId: 'default_physics',
    uploadedFiles: [], // Array of { id, file, name, size, dataUrl }
    evaluationResults: [], // Array of ScanResult objects
    selectedModalResult: null,
    isProcessing: false,
    activeToken: localStorage.getItem('omr_auth_token') || ''
  };

  // ── DOM References ────────────────────────────────────────────────────────
  const DOM = {
    navTabs: document.getElementById('navTabs'),
    panes: {
      scanner: document.getElementById('pane-scanner'),
      roster: document.getElementById('pane-roster'),
      keys: document.getElementById('pane-keys'),
      analytics: document.getElementById('pane-analytics')
    },
    rosterCount: document.getElementById('rosterCount'),
    
    // Scanner
    selectAnswerKey: document.getElementById('selectAnswerKey'),
    inputMarksCorrect: document.getElementById('inputMarksCorrect'),
    inputMarksPenalty: document.getElementById('inputMarksPenalty'),
    dispTotalQ: document.getElementById('dispTotalQ'),
    dispTotalOpts: document.getElementById('dispTotalOpts'),
    dispMaxScore: document.getElementById('dispMaxScore'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    dropzoneCount: document.getElementById('dropzoneCount'),
    btnEvaluateBatch: document.getElementById('btnEvaluateBatch'),
    btnEvaluateCount: document.getElementById('btnEvaluateCount'),
    btnClearFiles: document.getElementById('btnClearFiles'),
    btnSample12: document.getElementById('btnSample12'),
    btnSamplePDF50: document.getElementById('btnSamplePDF50'),
    btnSamplePDF200: document.getElementById('btnSamplePDF200'),
    btnLoadTestImages: document.getElementById('btnLoadTestImages'),
    btnEmptyLoadSamples: document.getElementById('btnEmptyLoadSamples'),
    btnEmptyLoadPDF50: document.getElementById('btnEmptyLoadPDF50'),
    btnEmptyLoadPDF200: document.getElementById('btnEmptyLoadPDF200'),
    emptyQueueState: document.getElementById('emptyQueueState'),
    thumbnailGrid: document.getElementById('thumbnailGrid'),
    queueSummaryBadge: document.getElementById('queueSummaryBadge'),
    pdfUnpackProgressBox: document.getElementById('pdfUnpackProgressBox'),
    pdfUnpackTitle: document.getElementById('pdfUnpackTitle'),
    pdfUnpackPct: document.getElementById('pdfUnpackPct'),
    pdfUnpackBarFill: document.getElementById('pdfUnpackBarFill'),
    pdfUnpackStatus: document.getElementById('pdfUnpackStatus'),
    pdfUnpackCount: document.getElementById('pdfUnpackCount'),
    evalProgressBox: document.getElementById('evalProgressBox'),
    progressStatusText: document.getElementById('progressStatusText'),
    progressPctText: document.getElementById('progressPctText'),
    progressBarFill: document.getElementById('progressBarFill'),
    progressSpeedText: document.getElementById('progressSpeedText'),
    progressItemCount: document.getElementById('progressItemCount'),

    // Roster
    kpiTotalStudents: document.getElementById('kpiTotalStudents'),
    kpiSetsDetected: document.getElementById('kpiSetsDetected'),
    kpiAvgScore: document.getElementById('kpiAvgScore'),
    kpiAvgPct: document.getElementById('kpiAvgPct'),
    kpiPassRate: document.getElementById('kpiPassRate'),
    kpiPassCount: document.getElementById('kpiPassCount'),
    kpiHigh: document.getElementById('kpiHigh'),
    kpiLow: document.getElementById('kpiLow'),
    btnExportTeacherCSV: document.getElementById('btnExportTeacherCSV'),
    btnExportStudentCSV: document.getElementById('btnExportStudentCSV'),
    btnExportPDFDossier: document.getElementById('btnExportPDFDossier'),
    inputTableSearch: document.getElementById('inputTableSearch'),
    filterSet: document.getElementById('filterSet'),
    filterGrade: document.getElementById('filterGrade'),
    rosterTableBody: document.getElementById('rosterTableBody'),

    // Keys Studio
    setSelectorBar: document.getElementById('setSelectorBar'),
    matrixRowsLeft: document.getElementById('matrixRowsLeft'),
    matrixRowsRight: document.getElementById('matrixRowsRight'),
    btnSaveKey: document.getElementById('btnSaveKey'),
    btnResetKeyDefaults: document.getElementById('btnResetKeyDefaults'),

    // Analytics
    gradeChartBars: document.getElementById('gradeChartBars'),
    itemAnalysisList: document.getElementById('itemAnalysisList'),

    // Modal
    modalInspector: document.getElementById('modalInspector'),
    modalCloseBtn: document.getElementById('modalCloseBtn'),
    modalStudentBadge: document.getElementById('modalStudentBadge'),
    modalStudentTitle: document.getElementById('modalStudentTitle'),
    modalAnnotatedImg: document.getElementById('modalAnnotatedImg'),
    modalTotalScore: document.getElementById('modalTotalScore'),
    modalPct: document.getElementById('modalPct'),
    modalGrade: document.getElementById('modalGrade'),
    modalBtnDownloadPDF: document.getElementById('modalBtnDownloadPDF'),
    modalBreakdownBody: document.getElementById('modalBreakdownBody')
  };

  // ── Helper Utilities ──────────────────────────────────────────────────────
  function getActiveKey() {
    return STATE.answerKeys.find(k => k.id === STATE.selectedKeyId) || STATE.answerKeys[0];
  }

  /**
   * Format marks to display integers as integers, or clean decimal values up to 3 decimal places (e.g. 0.125, 0.5, 1.5, 2, 3)
   */
  function formatMark(val) {
    const num = Number(val);
    if (isNaN(num)) return '0';
    if (Number.isInteger(num)) return num.toString();
    return parseFloat(num.toFixed(3)).toString();
  }

  /**
   * Marking Scheme Specification — Multiple Correct Answer Questions
   *
   * Definitions:
   *   n = number of correct answers for the question (correct.length)
   *   T = total marks allotted to the question (marksPerQuestion)
   *   m = number of correct answers the student selected (0 <= m <= n)
   *   P = number of wrong (incorrect) answers the student selected
   *   S = base score if only correct answers were selected = (m * T) / n
   *
   * Scoring Rules:
   *   1. No correct answer selected (m = 0): Mark = 0, regardless of P.
   *   2. At least one correct answer selected (m >= 1): Every wrong answer selected halves the current score.
   *      Mark = S * (1 / 2)^P = (m * T) / (n * 2^P)
   */
  function calculateQuestionMark(correct, selected, T = 3.0, optionsCount = 6) {
    const normCorrect = Array.isArray(correct) ? correct.filter(Boolean).sort() : [];
    const normSelected = Array.isArray(selected) ? selected.filter(Boolean).sort() : [];

    const n = normCorrect.length;
    const m = normSelected.filter(ans => normCorrect.includes(ans)).length;
    const P = normSelected.filter(ans => !normCorrect.includes(ans)).length;
    const totalSelected = normSelected.length;
    const maxMarks = Number(T) > 0 ? Number(T) : 3.0;

    const isExact = (n > 0 && m === n && P === 0);
    const isBlank = (totalSelected === 0);

    // Rule 1: No correct answer selected (m = 0) -> Mark = 0, regardless of P
    if (m === 0 || n === 0) {
      return {
        mark: 0,
        baseScore: 0,
        penalty: 0,
        m,
        P,
        n,
        T: maxMarks,
        totalSelected,
        isExact: false,
        isPartial: false,
        isBlank,
        status: isBlank ? 'BLANK' : 'WRONG',
        details: isBlank ? 'No options marked' : `0/${n} correct picked, ${P} wrong`
      };
    }

    // Rule 2: At least one correct answer selected (m >= 1):
    // S = (m * T) / n
    // Mark = S * (1/2)^P = (m * T) / (n * 2^P)
    const baseScore = (m * maxMarks) / n;
    const mark = baseScore / Math.pow(2, P);
    const penalty = baseScore - mark;
    const isPartial = !isExact && mark > 0;

    const status = isExact ? 'EXACT' : 'PARTIAL';
    const details = isExact
      ? `Full credit: ${n}/${n} correct picked`
      : `${m}/${n} correct picked, ${P} wrong (Halved ${P}x: ${formatMark(baseScore)} → ${formatMark(mark)})`;

    return {
      mark,
      baseScore,
      penalty,
      m,
      P,
      n,
      T: maxMarks,
      totalSelected,
      isExact,
      isPartial,
      isBlank: false,
      status,
      details
    };
  }

  function getGrade(pct) {
    if (pct >= 95) return 'A+';
    if (pct >= 85) return 'A';
    if (pct >= 80) return 'B+';
    if (pct >= 70) return 'B';
    if (pct >= 65) return 'C+';
    if (pct >= 55) return 'C';
    if (pct >= 45) return 'D';
    return 'F';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ── Navigation Handler ────────────────────────────────────────────────────
  DOM.navTabs.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.nav-tab');
    if (!tabBtn) return;
    const tabName = tabBtn.getAttribute('data-tab');
    switchTab(tabName);
  });

  function switchTab(tabName) {
    STATE.activeTab = tabName;
    document.querySelectorAll('.nav-tab').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });
    Object.keys(DOM.panes).forEach(paneKey => {
      DOM.panes[paneKey].classList.toggle('hidden', paneKey !== tabName);
    });

    if (tabName === 'roster') renderRosterTable();
    if (tabName === 'keys') renderKeyMatrixStudio();
    if (tabName === 'analytics') renderAnalytics();
  }

  // ── Multi-File Upload & Drag-Drop Handling ─────────────────────────────────
  DOM.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    DOM.dropzone.classList.add('dragover');
  });

  DOM.dropzone.addEventListener('dragleave', () => {
    DOM.dropzone.classList.remove('dragover');
  });

  DOM.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropzone.classList.remove('dragover');
    if (e.dataTransfer.files?.length) {
      handleFilesSelected(e.dataTransfer.files);
    }
  });

  DOM.fileInput.addEventListener('change', (e) => {
    if (e.target.files?.length) {
      handleFilesSelected(e.target.files);
      DOM.fileInput.value = '';
    }
  });

  async function handleFilesSelected(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        await unpackPDFFile(file);
      } else if (file.type.startsWith('image/')) {
        const fileId = 'file_' + Math.random().toString(36).substring(2, 9);
        const reader = new FileReader();
        reader.onload = (ev) => {
          STATE.uploadedFiles.push({
            id: fileId,
            file: file,
            name: file.name,
            size: file.size,
            dataUrl: ev.target.result,
            isPdfPage: false
          });
          updateQueueUI();
        };
        reader.readAsDataURL(file);
      }
    }
  }

  async function unpackPDFFile(file) {
    if (DOM.pdfUnpackProgressBox) {
      DOM.pdfUnpackProgressBox.classList.remove('hidden');
      DOM.pdfUnpackTitle.textContent = `📑 Unpacking PDF: ${file.name}...`;
      DOM.pdfUnpackBarFill.style.width = '0%';
      DOM.pdfUnpackPct.textContent = '0%';
      DOM.pdfUnpackCount.textContent = `Reading PDF structure...`;
    }

    let pages = [];

    // 1. Try In-Browser Client-Side Rendering with PDF.js (Zero server network overhead)
    if (window.pdfjsLib) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdfDoc.numPages;

        for (let p = 1; p <= totalPages; p++) {
          const page = await pdfDoc.getPage(p);
          const viewport = page.getViewport({ scale: 1.8 }); // 1.8x scale for crisp bubble resolution
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;

          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          pages.push({
            id: 'pdf_page_' + Math.random().toString(36).substring(2, 9),
            file: file,
            name: `${file.name} (Page ${p}/${totalPages})`,
            size: Math.round((dataUrl.length * 3) / 4),
            dataUrl: dataUrl,
            isPdfPage: true,
            pageNumber: p,
            totalPages: totalPages
          });

          const pct = Math.round((p / totalPages) * 100);
          if (DOM.pdfUnpackBarFill) DOM.pdfUnpackBarFill.style.width = `${pct}%`;
          if (DOM.pdfUnpackPct) DOM.pdfUnpackPct.textContent = `${pct}%`;
          if (DOM.pdfUnpackCount) DOM.pdfUnpackCount.textContent = `${p} / ${totalPages} Pages`;
        }
      } catch (pdfErr) {
        console.warn('Client-side PDF.js unpack failed, falling back to high-speed backend unpacker:', pdfErr);
        pages = await unpackPDFBackend(file);
      }
    } else {
      pages = await unpackPDFBackend(file);
    }

    STATE.uploadedFiles = [...STATE.uploadedFiles, ...pages];
    updateQueueUI();

    if (DOM.pdfUnpackProgressBox) {
      setTimeout(() => DOM.pdfUnpackProgressBox.classList.add('hidden'), 400);
    }
  }

  async function unpackPDFBackend(file) {
    const formData = new FormData();
    formData.append('pdf', file);
    const resp = await fetch('/api/omr/unpack-pdf', {
      method: 'POST',
      body: formData
    });
    const data = await resp.json();
    if (!data.success && data.error) throw new Error(data.error);
    return (data.pages || []).map(p => ({
      id: 'pdf_page_' + Math.random().toString(36).substring(2, 9),
      file: file,
      name: `${file.name} (Page ${p.pageNumber}/${data.totalPages})`,
      size: Math.round((p.dataUrl.length * 3) / 4),
      dataUrl: p.dataUrl,
      isPdfPage: true,
      pageNumber: p.pageNumber,
      totalPages: data.totalPages
    }));
  }

  function updateQueueUI() {
    const count = STATE.uploadedFiles.length;
    DOM.dropzoneCount.textContent = `${count} sheet${count === 1 ? '' : 's'} selected`;
    DOM.btnEvaluateCount.textContent = count;
    DOM.btnEvaluateBatch.disabled = count === 0 || STATE.isProcessing;
    DOM.btnClearFiles.disabled = count === 0 || STATE.isProcessing;

    if (count === 0) {
      DOM.emptyQueueState.classList.remove('hidden');
      DOM.thumbnailGrid.classList.add('hidden');
      DOM.queueSummaryBadge.textContent = 'Empty Queue';
      DOM.queueSummaryBadge.className = 'badge badge-secondary';
      return;
    }

    DOM.emptyQueueState.classList.add('hidden');
    DOM.thumbnailGrid.classList.remove('hidden');
    DOM.queueSummaryBadge.textContent = `${count} Ready for Evaluation`;
    DOM.queueSummaryBadge.className = 'badge badge-emerald';

    DOM.thumbnailGrid.innerHTML = STATE.uploadedFiles.map((f, idx) => {
      const pdfBadge = f.isPdfPage ? `<span class="thumb-pdf-tag">📄 Page ${f.pageNumber}</span>` : '';
      return `
        <div class="thumbnail-card" data-id="${f.id}">
          <div class="thumbnail-img-wrap">
            <img src="${f.dataUrl}" alt="${f.name}" class="thumbnail-img">
            <span class="thumb-badge">#${idx + 1}</span>
            ${pdfBadge}
            <button class="thumb-delete-btn" onclick="window.removeQueueFile('${f.id}')" title="Remove sheet">&times;</button>
          </div>
          <div class="thumb-footer">
            <div class="thumb-filename" title="${f.name}">${f.name}</div>
            <div class="thumb-meta">
              <span>${formatBytes(f.size)}</span>
              <span class="text-cyan">${f.isPdfPage ? 'PDF Sheet' : 'Scanned'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.removeQueueFile = function (fileId) {
    STATE.uploadedFiles = STATE.uploadedFiles.filter(f => f.id !== fileId);
    updateQueueUI();
  };

  DOM.btnClearFiles.addEventListener('click', () => {
    STATE.uploadedFiles = [];
    updateQueueUI();
  });

  // ── Quick Load Test Sheets & Multi-Page PDFs ──────────────────────────────
  async function loadSampleTestSheets() {
    DOM.evalProgressBox.classList.remove('hidden');
    DOM.progressStatusText.textContent = 'Fetching OMR sheets from server library...';
    DOM.progressBarFill.style.width = '30%';

    try {
      const resp = await fetch('/api/omr/sample-test-images?limit=12');
      if (!resp.ok) {
        throw new Error('Failed to load sample images endpoint');
      }
      const data = await resp.json();
      if (data.images && data.images.length) {
        STATE.uploadedFiles = data.images.map((imgItem, idx) => ({
          id: 'test_img_' + (idx + 1),
          name: imgItem.filename,
          size: imgItem.size || 204800,
          dataUrl: imgItem.dataUrl,
          isPdfPage: false
        }));
        updateQueueUI();
        DOM.evalProgressBox.classList.add('hidden');
        const totalMsg = data.total > data.loaded ? ` (${data.total} total in library)` : '';
        console.log(`Loaded ${data.loaded} test sheets${totalMsg}`);
      } else {
        DOM.evalProgressBox.classList.add('hidden');
        alert('No sample images found in the server library.');
      }
    } catch (err) {
      console.warn('Error loading test images:', err);
      DOM.evalProgressBox.classList.add('hidden');
      alert('Could not load sample images from server.');
    }
  }

  async function loadSamplePDF(count = 50) {
    if (DOM.pdfUnpackProgressBox) {
      DOM.pdfUnpackProgressBox.classList.remove('hidden');
      DOM.pdfUnpackTitle.textContent = `🏢 Ingesting Department PDF (${count} OMR Sheets)...`;
      DOM.pdfUnpackBarFill.style.width = '35%';
      DOM.pdfUnpackPct.textContent = '35%';
      DOM.pdfUnpackCount.textContent = `Building and unpacking ${count} pages...`;
    }

    try {
      const res = await fetch(`/api/omr/generate-sample-pdf?count=${count}&format=unpack`);
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();
      if (!data.pages || !data.pages.length) throw new Error('No pages unpacked');

      const unpacked = data.pages.map(p => ({
        id: 'pdf_sample_' + Math.random().toString(36).substring(2, 9),
        name: `Department_Exam_Batch_${count}_Students.pdf (Page ${p.pageNumber}/${data.totalPages})`,
        size: Math.round((p.dataUrl.length * 3) / 4),
        dataUrl: p.dataUrl,
        isPdfPage: true,
        pageNumber: p.pageNumber,
        totalPages: data.totalPages
      }));

      STATE.uploadedFiles = [...STATE.uploadedFiles, ...unpacked];
      updateQueueUI();

      if (DOM.pdfUnpackBarFill) DOM.pdfUnpackBarFill.style.width = '100%';
      if (DOM.pdfUnpackPct) DOM.pdfUnpackPct.textContent = '100%';
      if (DOM.pdfUnpackCount) DOM.pdfUnpackCount.textContent = `${count} / ${count} Pages Ready`;
    } catch (e) {
      console.error('Failed to load sample PDF:', e);
      alert('Failed to load sample PDF batch: ' + e.message);
    } finally {
      if (DOM.pdfUnpackProgressBox) {
        setTimeout(() => DOM.pdfUnpackProgressBox.classList.add('hidden'), 500);
      }
    }
  }

  DOM.btnSample12?.addEventListener('click', loadSampleTestSheets);
  DOM.btnSamplePDF50?.addEventListener('click', () => loadSamplePDF(50));
  DOM.btnSamplePDF200?.addEventListener('click', () => loadSamplePDF(200));

  DOM.btnLoadTestImages?.addEventListener('click', () => {
    switchTab('scanner');
    loadSampleTestSheets();
  });
  DOM.btnEmptyLoadSamples?.addEventListener('click', loadSampleTestSheets);
  DOM.btnEmptyLoadPDF50?.addEventListener('click', () => loadSamplePDF(50));
  DOM.btnEmptyLoadPDF200?.addEventListener('click', () => loadSamplePDF(200));

  // ── Batch Evaluation Engine ───────────────────────────────────────────────
  DOM.btnEvaluateBatch.addEventListener('click', async () => {
    if (!STATE.uploadedFiles.length || STATE.isProcessing) return;

    STATE.isProcessing = true;
    DOM.btnEvaluateBatch.disabled = true;
    DOM.btnClearFiles.disabled = true;
    DOM.evalProgressBox.classList.remove('hidden');

    const total = STATE.uploadedFiles.length;
    const activeKey = getActiveKey();
    const marksPerQ = parseFloat(DOM.inputMarksCorrect.value) || 3.0;
    const penaltyPerW = parseFloat(DOM.inputMarksPenalty.value) || 0.0;
    const totalMarksPossible = activeKey.totalQuestions * marksPerQ;

    const newResults = [];
    const startTime = Date.now();

    for (let i = 0; i < total; i++) {
      const item = STATE.uploadedFiles[i];
      const pct = Math.round(((i + 1) / total) * 100);

      DOM.progressStatusText.textContent = `Evaluating Sheet ${i + 1} of ${total}: ${item.name}`;
      DOM.progressPctText.textContent = `${pct}%`;
      DOM.progressBarFill.style.width = `${pct}%`;
      DOM.progressItemCount.textContent = `${i + 1} / ${total} Sheets`;

      try {
        const payload = {
          image: item.dataUrl,
          numQuestions: activeKey.totalQuestions,
          optionsPerQuestion: activeKey.optionsPerQuestion,
          correctAnswers: activeKey.answers
        };

        const res = await fetch('/api/omr/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const omrData = await res.json();
        const detectedRoll = omrData.detectedRollNumber || '00000';
        const detectedSet = omrData.detectedSet || 'SET 1';
        const detectedAnswers = omrData.detectedAnswers || [];

        // Match against specific set answers if available
        const setKeyAnswers = activeKey.setAnswers?.[detectedSet] || activeKey.answers;

        let correctCount = 0;
        let partialCount = 0;
        let wrongCount = 0;
        let blankCount = 0;
        let totalScore = 0;

        const questionResults = [];
        for (let q = 0; q < activeKey.totalQuestions; q++) {
          const selected = detectedAnswers[q] || [];
          const correct = setKeyAnswers[q] || [];

          const qGrading = calculateQuestionMark(correct, selected, marksPerQ, activeKey.optionsPerQuestion);
          totalScore += qGrading.mark;

          if (qGrading.isExact) {
            correctCount++;
          } else if (qGrading.isPartial) {
            partialCount++;
          } else if (qGrading.isBlank) {
            blankCount++;
          } else {
            wrongCount++;
          }

          questionResults.push({
            questionNumber: q + 1,
            selected,
            correct,
            isCorrect: qGrading.isExact,
            isPartial: qGrading.isPartial,
            isBlank: qGrading.isBlank,
            mark: qGrading.mark,
            baseScore: qGrading.baseScore,
            penalty: qGrading.penalty,
            m: qGrading.m,
            P: qGrading.P,
            n: qGrading.n,
            T: qGrading.T,
            status: qGrading.status,
            details: qGrading.details,
            maxMarks: marksPerQ
          });
        }

        totalScore = Math.max(0, totalScore);
        const percentage = Math.round((totalScore / totalMarksPossible) * 1000) / 10;
        const grade = getGrade(percentage);

        const scanResult = {
          id: 'res_' + Math.random().toString(36).substring(2, 9),
          filename: item.name,
          answerKeyId: activeKey.id,
          answerKeyName: activeKey.name,
          subject: activeKey.subject,
          score: totalScore,
          totalQuestions: activeKey.totalQuestions,
          totalMarks: totalMarksPossible,
          percentage: percentage,
          grade: grade,
          detectedAnswers: detectedAnswers,
          correctAnswers: setKeyAnswers,
          questionResults: questionResults,
          annotatedImage: omrData.annotatedImage || item.dataUrl,
          detectedSet: detectedSet,
          detectedRollNumber: detectedRoll,
          correctCount,
          partialCount,
          wrongCount,
          blankCount,
          createdAt: new Date().toISOString()
        };

        newResults.push(scanResult);

        // Save to backend database
        try {
          await fetch('/api/results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(scanResult)
          });
        } catch (e) {
          console.warn('Result persisted locally:', e);
        }

      } catch (err) {
        console.error('Error evaluating sheet:', item.name, err);
      }
    }

    STATE.evaluationResults = [...STATE.evaluationResults, ...newResults];
    STATE.isProcessing = false;
    DOM.btnEvaluateBatch.disabled = false;
    DOM.btnClearFiles.disabled = false;
    DOM.evalProgressBox.classList.add('hidden');

    // Switch to Roster tab to view results
    switchTab('roster');
  });

  // ── Roster & Table Rendering ──────────────────────────────────────────────
  function renderRosterTable() {
    const list = STATE.evaluationResults;
    DOM.rosterCount.textContent = list.length;

    // Calculate Class KPIs
    if (list.length === 0) {
      DOM.kpiTotalStudents.textContent = '0';
      DOM.kpiSetsDetected.textContent = '0 Sets';
      DOM.kpiAvgScore.textContent = '0.00';
      DOM.kpiAvgPct.textContent = '0.0% Avg';
      DOM.kpiPassRate.textContent = '0.0%';
      DOM.kpiPassCount.textContent = '0 Passed';
      DOM.kpiHigh.textContent = '0';
      DOM.kpiLow.textContent = '0';
      DOM.rosterTableBody.innerHTML = `<tr><td colspan="9" class="table-empty-row">No evaluation records yet. Upload and evaluate sheets in the Scanner tab.</td></tr>`;
      return;
    }

    const scores = list.map(r => r.score);
    const avgScore = (scores.reduce((a, b) => a + b, 0) / list.length).toFixed(2);
    const maxMarks = list[0]?.totalMarks || 30.0;
    const avgPct = ((parseFloat(avgScore) / maxMarks) * 100).toFixed(1);
    const passCount = list.filter(r => r.percentage >= 50).length;
    const passRate = ((passCount / list.length) * 100).toFixed(1);
    const highest = Math.max(...scores);
    const lowest = Math.min(...scores);
    const sets = Array.from(new Set(list.map(r => r.detectedSet)));

    DOM.kpiTotalStudents.textContent = list.length;
    DOM.kpiSetsDetected.textContent = `${sets.length} Set${sets.length === 1 ? '' : 's'} (${sets.join(', ')})`;
    DOM.kpiAvgScore.textContent = avgScore;
    DOM.kpiAvgPct.textContent = `${avgPct}% Class Avg`;
    DOM.kpiPassRate.textContent = `${passRate}%`;
    DOM.kpiPassCount.textContent = `${passCount} of ${list.length} Passed`;
    DOM.kpiHigh.textContent = formatMark(highest);
    DOM.kpiLow.textContent = formatMark(lowest);

    // Apply Search & Filters
    const query = DOM.inputTableSearch.value.trim().toLowerCase();
    const setFilter = DOM.filterSet.value;
    const gradeFilter = DOM.filterGrade.value;

    // Sort roll-number-wise (numerical or string sort)
    let filtered = [...list].sort((a, b) => {
      const numA = parseInt(a.detectedRollNumber, 10);
      const numB = parseInt(b.detectedRollNumber, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.detectedRollNumber.localeCompare(b.detectedRollNumber);
    });

    if (query) {
      filtered = filtered.filter(r => r.detectedRollNumber.toLowerCase().includes(query));
    }
    if (setFilter !== 'ALL') {
      filtered = filtered.filter(r => r.detectedSet === setFilter);
    }
    if (gradeFilter === 'PASS') {
      filtered = filtered.filter(r => r.percentage >= 50);
    } else if (gradeFilter === 'FAIL') {
      filtered = filtered.filter(r => r.percentage < 50);
    }

    if (filtered.length === 0) {
      DOM.rosterTableBody.innerHTML = `<tr><td colspan="9" class="table-empty-row">No records match the active filter criteria.</td></tr>`;
      return;
    }

    DOM.rosterTableBody.innerHTML = filtered.map((r, idx) => {
      const gradeClass = 'grade-' + r.grade.replace('+', '-plus');
      return `
        <tr>
          <td><strong class="text-cyan">#${idx + 1}</strong></td>
          <td><span class="roll-code-pill">${r.detectedRollNumber}</span></td>
          <td><span class="badge badge-primary">${r.detectedSet}</span></td>
          <td><span class="score-pill">${formatMark(r.score)} / ${formatMark(r.totalMarks)}</span></td>
          <td><strong>${r.percentage}%</strong></td>
          <td><span class="grade-chip ${gradeClass}">${r.grade}</span></td>
          <td>
            <span class="text-emerald" title="Exact Correct">🟢 ${r.correctCount || 0}</span> •
            <span class="text-cyan" title="Partial Credit">🔵 ${r.partialCount || 0}</span> •
            <span class="text-crimson" title="Wrong">🔴 ${r.wrongCount || 0}</span> •
            <span class="text-muted" title="Blank">⚪ ${r.blankCount || 0}</span>
          </td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="window.inspectResult('${r.id}')">
              🔍 View Sheet
            </button>
          </td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="window.downloadSinglePDF('${r.id}')">
              📄 PDF
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  DOM.inputTableSearch.addEventListener('input', renderRosterTable);
  DOM.filterSet.addEventListener('change', renderRosterTable);
  DOM.filterGrade.addEventListener('change', renderRosterTable);

  // ── Visual Graded OMR Modal Inspector ─────────────────────────────────────
  window.inspectResult = function (resultId) {
    const item = STATE.evaluationResults.find(r => r.id === resultId);
    if (!item) return;

    STATE.selectedModalResult = item;
    DOM.modalStudentBadge.textContent = `Roll: ${item.detectedRollNumber} • ${item.detectedSet} • ${item.subject || 'PHY101'}`;
    DOM.modalStudentTitle.textContent = `Scorecard: ${formatMark(item.score)} / ${formatMark(item.totalMarks)} (${item.percentage}%)`;
    DOM.modalAnnotatedImg.src = item.annotatedImage || '';
    DOM.modalTotalScore.textContent = `${formatMark(item.score)} / ${formatMark(item.totalMarks)}`;
    DOM.modalPct.textContent = `${item.percentage}%`;
    DOM.modalGrade.textContent = item.grade;

    DOM.modalBreakdownBody.innerHTML = item.questionResults.map(q => {
      let statusBadge = '<span class="badge badge-crimson">✗ Wrong</span>';
      if (q.isCorrect) {
        statusBadge = '<span class="badge badge-emerald">✓ Exact</span>';
      } else if (q.isPartial || (Number(q.mark) > 0 && !q.isCorrect)) {
        statusBadge = '<span class="badge badge-cyan">≈ Partial</span>';
      } else if (q.isBlank || !q.selected || q.selected.length === 0) {
        statusBadge = '<span class="badge badge-amber">⚪ Blank</span>';
      }

      const scoreDisplay = Number(q.mark) > 0 ? `+${formatMark(q.mark)}` : '0';
      const analysisDetail = q.details || (
        q.isCorrect 
          ? `Full credit: ${q.n || 1}/${q.n || 1} correct picked` 
          : Number(q.mark) > 0 
            ? `${q.m || 1}/${q.n || 1} correct, ${q.P || 0} wrong (Halved ${q.P || 0}x)`
            : (q.selected && q.selected.length ? `0 correct picked` : `Unanswered`)
      );

      return `
        <tr>
          <td><strong>Q${q.questionNumber}</strong></td>
          <td><span class="badge ${q.selected && q.selected.length ? 'badge-secondary' : 'badge-amber'}">${q.selected && q.selected.length ? q.selected.join(', ') : 'BLANK'}</span></td>
          <td><span class="badge badge-primary">${q.correct ? q.correct.join(', ') : '—'}</span></td>
          <td><span class="text-muted" style="font-size: 0.76rem;">${analysisDetail}</span></td>
          <td><strong class="${q.isCorrect ? 'text-emerald' : Number(q.mark) > 0 ? 'text-cyan' : 'text-crimson'}">${scoreDisplay}</strong> <span class="text-muted" style="font-size: 0.7rem;">/ ${q.maxMarks || 3}</span></td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    DOM.modalInspector.classList.remove('hidden');
  };

  DOM.modalCloseBtn.addEventListener('click', () => {
    DOM.modalInspector.classList.add('hidden');
  });

  DOM.modalInspector.addEventListener('click', (e) => {
    if (e.target === DOM.modalInspector) {
      DOM.modalInspector.classList.add('hidden');
    }
  });

  // ── Export Actions (Dual CSV & Multi-Page PDF) ─────────────────────────────
  
  // 1. Teacher Master CSV Export (via server-side API for rich formatted output)
  DOM.btnExportTeacherCSV.addEventListener('click', async () => {
    if (!STATE.evaluationResults.length) {
      alert('Please evaluate sheets before exporting CSV.');
      return;
    }

    const btn = DOM.btnExportTeacherCSV;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> Generating...`;

    try {
      const ids = STATE.evaluationResults.map(r => r.id).join(',');
      const url = `/api/results/export/csv?type=teacher&ids=${encodeURIComponent(ids)}`;
      const resp = await fetch(url, {
        headers: STATE.activeToken ? { 'Authorization': `Bearer ${STATE.activeToken}` } : {}
      });

      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

      const blob = await resp.blob();
      const dlUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = dlUrl;
      link.download = `Teacher_Master_Ledger_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(dlUrl);
    } catch (err) {
      console.error('Teacher CSV export failed, using local fallback:', err);
      // Fallback to local generation
      exportTeacherCSVLocal();
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  function exportTeacherCSVLocal() {
    // 1. Calculate ranks based on score descending
    const ranked = [...STATE.evaluationResults].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const rankMap = new Map();
    ranked.forEach((r, idx) => rankMap.set(r.id, idx + 1));

    // 2. Sort candidates strictly Roll Number wise (natural numerical sort)
    const list = [...STATE.evaluationResults].sort((a, b) => {
      const rollA = String(a.detectedRollNumber || '').trim();
      const rollB = String(b.detectedRollNumber || '').trim();
      return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const activeKey = getActiveKey();
    const maxQ = activeKey.totalQuestions;

    let csv = `=== BUBBLESCAN TEACHER MASTER ASSESSMENT LEDGER ===\n`;
    csv += `Exam,${activeKey.name},Subject,${activeKey.subject},Date,${new Date().toLocaleDateString()}\n`;
    csv += `Total Students,${list.length},Class Avg,${(list.reduce((a,b)=>a+b.score,0)/list.length).toFixed(2)},Pass Rate,${((list.filter(r=>r.percentage>=50).length/list.length)*100).toFixed(1)}%\n`;
    csv += `Marking Scheme,Multiple Correct Answer Questions: Mark = (m * T) / (n * 2^P)\n\n`;

    const qHeaders = [];
    for (let q = 1; q <= maxQ; q++) {
      qHeaders.push(`Q${q} Marked`, `Q${q} Key`, `Q${q} Mark`, `Q${q} Status`);
    }
    csv += `S.No.,Rank,Roll Number,Set,Marks Obtained,Max Marks,Percentage (%),Grade,Result Status,Exact Correct,Partial Credit,Wrong,Blank,${qHeaders.join(',')},Evaluated At\n`;

    list.forEach((r, idx) => {
      const rank = rankMap.get(r.id) || idx + 1;
      const qCols = [];
      for (let q = 0; q < maxQ; q++) {
        const qr = r.questionResults[q];
        if (qr) {
          qCols.push(
            `"${qr.selected.join('+')}"`,
            `"${qr.correct.join('+')}"`,
            formatMark(qr.mark),
            qr.isCorrect ? 'CORRECT' : Number(qr.mark) > 0 ? 'PARTIAL' : qr.selected.length === 0 ? 'BLANK' : 'WRONG'
          );
        } else {
          qCols.push('""', '""', '0', 'BLANK');
        }
      }
      csv += `${idx + 1},#${rank},"${r.detectedRollNumber}","${r.detectedSet}",${formatMark(r.score)},${formatMark(r.totalMarks)},${r.percentage},"${r.grade}","${r.percentage >= 50 ? 'PASSED' : 'NEEDS ATTENTION'}",${r.correctCount || 0},${r.partialCount || 0},${r.wrongCount || 0},${r.blankCount || 0},${qCols.join(',')},"${r.createdAt}"\n`;
    });

    downloadBlob(csv, `Teacher_Master_Ledger_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
  }

  // 2. Student Scorecards CSV Export (via server-side API)
  DOM.btnExportStudentCSV.addEventListener('click', async () => {
    if (!STATE.evaluationResults.length) {
      alert('Please evaluate sheets before exporting CSV.');
      return;
    }

    const btn = DOM.btnExportStudentCSV;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg> Generating...`;

    try {
      const ids = STATE.evaluationResults.map(r => r.id).join(',');
      const url = `/api/results/export/csv?type=student&ids=${encodeURIComponent(ids)}`;
      const resp = await fetch(url, {
        headers: STATE.activeToken ? { 'Authorization': `Bearer ${STATE.activeToken}` } : {}
      });

      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

      const blob = await resp.blob();
      const dlUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = dlUrl;
      link.download = `Student_Scorecards_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(dlUrl);
    } catch (err) {
      console.error('Student CSV export failed, using local fallback:', err);
      exportStudentCSVLocal();
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  function exportStudentCSVLocal() {
    // 1. Calculate ranks based on score descending
    const ranked = [...STATE.evaluationResults].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const rankMap = new Map();
    ranked.forEach((r, idx) => rankMap.set(r.id, idx + 1));

    // 2. Sort candidates strictly Roll Number wise (natural numerical sort)
    const list = [...STATE.evaluationResults].sort((a, b) => {
      const rollA = String(a.detectedRollNumber || '').trim();
      const rollB = String(b.detectedRollNumber || '').trim();
      return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const activeKey = getActiveKey();
    const maxQ = activeKey.totalQuestions;

    let csv = `=== STUDENT SCORECARD & PERFORMANCE ROSTER ===\n`;
    csv += `Exam,${activeKey.name},Subject,${activeKey.subject},Total Questions,${maxQ},Max Marks,${formatMark(activeKey.totalQuestions * activeKey.marksPerQuestion)}\n\n`;

    const qHeaders = [];
    for (let q = 1; q <= maxQ; q++) {
      qHeaders.push(`Q${q} Marked`, `Q${q} Mark`, `Q${q} Status`);
    }
    csv += `Rank,Roll Number,Set,Marks Obtained,Total Marks,Percentage (%),Grade,Result,Remarks,${qHeaders.join(',')},Date\n`;

    list.forEach((r, idx) => {
      const rank = rankMap.get(r.id) || idx + 1;
      const qCols = [];
      for (let q = 0; q < maxQ; q++) {
        const qr = r.questionResults[q];
        if (qr) {
          const qStatus = qr.isCorrect ? 'CORRECT' : Number(qr.mark) > 0 ? 'PARTIAL' : qr.selected.length === 0 ? 'BLANK' : 'WRONG';
          qCols.push(`"${qr.selected.join('+')}"`, formatMark(qr.mark), qStatus);
        } else {
          qCols.push('""', '0', 'BLANK');
        }
      }
      const remark = r.percentage >= 85 ? 'Outstanding' : r.percentage >= 70 ? 'Very Good' : r.percentage >= 50 ? 'Satisfactory' : 'Needs Improvement';
      csv += `#${rank},"${r.detectedRollNumber}","${r.detectedSet}",${formatMark(r.score)},${formatMark(r.totalMarks)},${r.percentage},"${r.grade}","${r.percentage >= 50 ? 'PASS' : 'FAIL'}","${remark}",${qCols.join(',')},"${new Date(r.createdAt).toLocaleDateString()}"\n`;
    });

    downloadBlob(csv, `Student_Scorecards_Roster_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
  }

  // 3. Multi-Page Institutional PDF Dossier
  DOM.btnExportPDFDossier.addEventListener('click', async () => {
    if (!STATE.evaluationResults.length) {
      alert('Please evaluate sheets before exporting PDF.');
      return;
    }

    const ids = STATE.evaluationResults.map(r => r.id).join(',');
    window.open(`/api/results/export/pdf?ids=${encodeURIComponent(ids)}`, '_blank');
  });

  // 4. Single Student PDF Download
  window.downloadSinglePDF = function (resultId) {
    window.open(`/api/results/${encodeURIComponent(resultId)}/export/pdf`, '_blank');
  };

  DOM.modalBtnDownloadPDF.addEventListener('click', () => {
    if (STATE.selectedModalResult) {
      window.downloadSinglePDF(STATE.selectedModalResult.id);
    }
  });

  function downloadBlob(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ── Answer Key Studio ─────────────────────────────────────────────────────
  DOM.setSelectorBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.set-tab');
    if (!tab) return;
    STATE.activeSetTab = tab.getAttribute('data-set');
    document.querySelectorAll('.set-tab').forEach(b => b.classList.toggle('active', b === tab));
    renderKeyMatrixStudio();
  });

  function renderKeyMatrixStudio() {
    const activeKey = getActiveKey();
    const currentSet = STATE.activeSetTab;
    const currentSetAnswers = activeKey.setAnswers?.[currentSet] || activeKey.answers;
    const optLabels = ['A', 'B', 'C', 'D', 'E', 'F'];

    // Left Column Q1..Q5
    DOM.matrixRowsLeft.innerHTML = [0, 1, 2, 3, 4].map(qIdx => {
      const qAns = currentSetAnswers[qIdx] || [];
      return `
        <div class="matrix-row">
          <span class="matrix-q-num">Q${qIdx + 1}</span>
          <div class="matrix-bubbles-row">
            ${optLabels.map(opt => `
              <button class="matrix-bubble-btn ${qAns.includes(opt) ? 'selected' : ''}" 
                onclick="window.toggleKeyBubble('${currentSet}', ${qIdx}, '${opt}')">
                ${opt}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Right Column Q6..Q10
    DOM.matrixRowsRight.innerHTML = [5, 6, 7, 8, 9].map(qIdx => {
      const qAns = currentSetAnswers[qIdx] || [];
      return `
        <div class="matrix-row">
          <span class="matrix-q-num">Q${qIdx + 1}</span>
          <div class="matrix-bubbles-row">
            ${optLabels.map(opt => `
              <button class="matrix-bubble-btn ${qAns.includes(opt) ? 'selected' : ''}" 
                onclick="window.toggleKeyBubble('${currentSet}', ${qIdx}, '${opt}')">
                ${opt}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  window.toggleKeyBubble = function (setName, qIdx, option) {
    const activeKey = getActiveKey();
    if (!activeKey.setAnswers) activeKey.setAnswers = {};
    if (!activeKey.setAnswers[setName]) activeKey.setAnswers[setName] = JSON.parse(JSON.stringify(activeKey.answers));

    const currentArr = activeKey.setAnswers[setName][qIdx] || [];
    if (currentArr.includes(option)) {
      activeKey.setAnswers[setName][qIdx] = currentArr.filter(o => o !== option);
    } else {
      activeKey.setAnswers[setName][qIdx] = [...currentArr, option].sort();
    }
    renderKeyMatrixStudio();
  };

  DOM.btnSaveKey.addEventListener('click', () => {
    const activeKey = getActiveKey();
    // Flash success indicator
    DOM.btnSaveKey.textContent = '✓ Saved!';
    DOM.btnSaveKey.style.background = 'var(--color-emerald)';
    setTimeout(() => {
      DOM.btnSaveKey.textContent = 'Save Key Configuration';
      DOM.btnSaveKey.style.background = '';
    }, 2000);
    // Persist to backend if we have an active session
    fetch('/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(STATE.activeToken ? { 'Authorization': `Bearer ${STATE.activeToken}` } : {})
      },
      body: JSON.stringify({
        id: activeKey.id,
        name: activeKey.name,
        subject: activeKey.subject,
        totalQuestions: activeKey.totalQuestions,
        optionsPerQuestion: activeKey.optionsPerQuestion,
        marksPerQuestion: activeKey.marksPerQuestion,
        answers: activeKey.answers,
        setAnswers: activeKey.setAnswers
      })
    }).catch(e => console.warn('Could not persist key to server:', e));
  });

  DOM.btnResetKeyDefaults.addEventListener('click', () => {
    const activeKey = getActiveKey();
    activeKey.setAnswers = {
      'SET 1': [['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D']],
      'SET 2': [['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E']],
      'SET 3': [['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F']],
      'SET 4': [['D'], ['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A']],
      'SET 5': [['E'], ['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B']],
      'SET 6': [['F'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['A'], ['B'], ['C']],
    };
    activeKey.answers = activeKey.setAnswers['SET 1'];
    renderKeyMatrixStudio();
    DOM.btnResetKeyDefaults.textContent = '✓ Reset!';
    setTimeout(() => {
      DOM.btnResetKeyDefaults.textContent = 'Reset to Default Sets';
    }, 2000);
  });

  // ── Analytics & IRT Insights ──────────────────────────────────────────────
  function renderAnalytics() {
    const list = STATE.evaluationResults;
    if (!list.length) {
      DOM.gradeChartBars.innerHTML = `<p class="text-muted">No evaluation data available yet.</p>`;
      DOM.itemAnalysisList.innerHTML = `<p class="text-muted">No item response statistics available yet.</p>`;
      return;
    }

    // Grades
    const grades = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];
    const gradeCounts = {};
    grades.forEach(g => gradeCounts[g] = 0);
    list.forEach(r => {
      if (gradeCounts[r.grade] !== undefined) gradeCounts[r.grade]++;
    });

    DOM.gradeChartBars.innerHTML = grades.map(g => {
      const cnt = gradeCounts[g];
      const pct = ((cnt / list.length) * 100).toFixed(0);
      return `
        <div class="chart-bar-row">
          <span class="chart-bar-label">${g}</span>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width: ${pct}%"></div>
          </div>
          <span class="chart-bar-count">${cnt}</span>
        </div>
      `;
    }).join('');

    // Item Response Statistics Q1..Q10
    const activeKey = getActiveKey();
    const itemStats = [];
    for (let q = 0; q < activeKey.totalQuestions; q++) {
      let correctCnt = 0;
      list.forEach(r => {
        if (r.questionResults[q]?.isCorrect) correctCnt++;
      });
      const pct = Math.round((correctCnt / list.length) * 100);
      itemStats.push({ q: q + 1, correctCnt, pct });
    }

    DOM.itemAnalysisList.innerHTML = itemStats.map(item => `
      <div class="item-stat-row">
        <span class="item-stat-q">Question ${item.q}</span>
        <div class="progress-bar-bg" style="width: 140px; margin: 0;">
          <div class="progress-bar-fill" style="width: ${item.pct}%"></div>
        </div>
        <span class="item-stat-pct ${item.pct >= 70 ? 'text-emerald' : item.pct >= 40 ? 'text-amber' : 'text-crimson'}">${item.pct}% Correct</span>
      </div>
    `).join('');
  }

  // ── Sample Test Images API Route Registration ─────────────────────────────
  // Initial setup
  updateQueueUI();
  renderKeyMatrixStudio();

  // Fetch and display library count badge
  (async () => {
    try {
      const badge = document.getElementById('libraryCountBadge');
      if (!badge) return;
      const resp = await fetch('/api/omr/sample-test-images?limit=0');
      if (resp.ok) {
        const data = await resp.json();
        if (data.total !== undefined) {
          badge.textContent = data.total + ' sheets';
          badge.title = `${data.total} OMR sheets in server library (omr_sheets/)`;
        }
      }
    } catch (e) {
      // silently ignore — badge will show static fallback
    }
  })();

})();
