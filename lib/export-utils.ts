import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { ScanResult } from './types';
import { getGrade } from './types';

function formatMark(value: number): string {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Sort scan results by Roll Number ascending.
 * Numeric roll numbers are sorted numerically (e.g. 14037, 26380, 27159, 38062...),
 * non-numeric or empty strings are sorted at the end alphabetically.
 */
export function sortResultsByRollNumber(results: ScanResult[]): ScanResult[] {
  return [...results].sort((a, b) => {
    const rollA = (a.detectedRollNumber || '').trim();
    const rollB = (b.detectedRollNumber || '').trim();

    if (!rollA && !rollB) return 0;
    if (!rollA) return 1;
    if (!rollB) return -1;

    const numA = parseInt(rollA, 10);
    const numB = parseInt(rollB, 10);

    if (!isNaN(numA) && !isNaN(numB) && String(numA) === rollA && String(numB) === rollB) {
      return numA - numB;
    }
    return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const escapeCSV = (str: string | number | undefined | null) => {
  const val = String(str ?? '');
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
};

/**
 * 1. TEACHER REFERENCE CSV (Master Analytics & Item Response Theory Ledger)
 * Contains comprehensive item-level data, metrics, penalties, score statistics, and IRT indices.
 */
export function generateTeacherCSV(results: ScanResult[], examTitle?: string): string {
  const sorted = sortResultsByRollNumber(results);
  const maxQ = Math.max(0, ...sorted.map((r) => r.totalQuestions || r.questionResults?.length || 0));

  // Compute Class Analytics
  const scores = sorted.map((r) => Number(r.score) || 0);
  const pcts = sorted.map((r) => Number(r.percentage) || 0);
  const totalStudents = sorted.length;
  const avgScore = totalStudents ? scores.reduce((a, b) => a + b, 0) / totalStudents : 0;
  const avgPct = totalStudents ? pcts.reduce((a, b) => a + b, 0) / totalStudents : 0;
  const maxScore = totalStudents ? Math.max(...scores) : 0;
  const minScore = totalStudents ? Math.min(...scores) : 0;
  const passCount = pcts.filter((p) => p >= 45).length;
  const passRate = totalStudents ? (passCount / totalStudents) * 100 : 0;

  // Compute Ranks (Score descending)
  const ranked = [...sorted].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const rankMap = new Map<string, number>();
  ranked.forEach((r, idx) => rankMap.set(r.id, idx + 1));

  const rows: string[] = [];

  // Metadata Header
  rows.push(`"=== BUBBLESCAN TEACHER MASTER ASSESSMENT LEDGER ==="`);
  rows.push(`"Exam Name: ${examTitle ? examTitle.replace(/"/g, '""') : sorted[0]?.answerKeyName || 'OMR Exam'}"`);
  rows.push(`"Subject: ${sorted[0]?.subject || 'Assessment'}"`);
  rows.push(`"Total Candidates Evaluated: ${totalStudents}"`);
  rows.push(`"Class Average Score: ${avgScore.toFixed(2)} (${avgPct.toFixed(1)}%)"`);
  rows.push(`"Highest Score: ${maxScore.toFixed(2)} | Lowest Score: ${minScore.toFixed(2)}"`);
  rows.push(`"Pass Rate (>=45%): ${passRate.toFixed(1)}% (${passCount}/${totalStudents} Passed)"`);
  rows.push(`"Report Generated At: ${new Date().toLocaleString()}"`);
  rows.push('');

  // Column Headers
  const headers = [
    'S.No.',
    'Rank',
    'Roll Number',
    'Set',
    'Exam Name',
    'Subject',
    'Marks Obtained',
    'Max Marks',
    'Percentage (%)',
    'Grade',
    'Result Status',
    'Correct Count',
    'Partial Count',
    'Wrong Count',
    'Blank Count',
  ];

  for (let q = 1; q <= maxQ; q++) {
    headers.push(`Q${q} Marked`, `Q${q} Key`, `Q${q} Marks`, `Q${q} Status`);
  }
  headers.push('Evaluation Timestamp');

  rows.push(headers.map(escapeCSV).join(','));

  // Data Rows
  sorted.forEach((item, index) => {
    const grade = getGrade(item.percentage);
    const dateStr = new Date(item.scannedAt).toLocaleString();
    const rank = rankMap.get(item.id) || index + 1;
    const status = item.percentage >= 45 ? 'PASSED' : 'NEEDS ATTENTION';

    const qResults = item.questionResults || [];
    const corrCnt = qResults.filter((q) => q.isCorrect).length;
    const partCnt = qResults.filter((q) => !q.isCorrect && (Number(q.mark) > 0)).length;
    const wrongCnt = qResults.filter((q) => !q.isCorrect && (Number(q.mark) === 0) && (q.selected && q.selected.length > 0)).length;
    const blankCnt = qResults.filter((q) => !q.selected || q.selected.length === 0).length;

    const row = [
      index + 1,
      `#${rank}`,
      item.detectedRollNumber || 'N/A',
      item.detectedSet || 'N/A',
      item.answerKeyName,
      item.subject,
      formatMark(item.score),
      formatMark(item.totalMarks || item.totalQuestions),
      `${Math.round(item.percentage)}%`,
      grade,
      status,
      corrCnt,
      partCnt,
      wrongCnt,
      blankCnt,
    ];

    const qMap = new Map(qResults.map((qr) => [qr.questionNumber, qr]));

    for (let q = 1; q <= maxQ; q++) {
      const qr = qMap.get(q);
      if (qr) {
        const marked = Array.isArray(qr.selected) ? qr.selected.join('+') : qr.selected || '';
        const correct = Array.isArray(qr.correct) ? qr.correct.join('+') : qr.correct || '';
        const isBlank = !marked;
        const isPartial = !qr.isCorrect && Number(qr.mark) > 0;
        const qStatus = qr.isCorrect ? 'Correct' : isPartial ? 'Partial' : isBlank ? 'Blank' : 'Wrong';
        row.push(marked || '—', correct || '—', formatMark(qr.mark), qStatus);
      } else {
        row.push('—', '—', '0', 'Blank');
      }
    }

    row.push(dateStr);
    rows.push(row.map(escapeCSV).join(','));
  });

  return '\uFEFF' + rows.join('\r\n');
}

/**
 * 2. STUDENT REFERENCE CSV (Scorecard & Public Results Roster)
 * Clean, friendly format for sharing with students, parents, and student portals.
 */
export function generateStudentCSV(results: ScanResult[], examTitle?: string): string {
  const sorted = sortResultsByRollNumber(results);
  const maxQ = Math.max(0, ...sorted.map((r) => r.totalQuestions || r.questionResults?.length || 0));

  const ranked = [...sorted].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const rankMap = new Map<string, number>();
  ranked.forEach((r, idx) => rankMap.set(r.id, idx + 1));

  const rows: string[] = [];

  // Title Header
  rows.push(`"=== STUDENT SCORECARD & PERFORMANCE ROSTER ==="`);
  rows.push(`"Exam: ${examTitle ? examTitle.replace(/"/g, '""') : sorted[0]?.answerKeyName || 'Examination'}"`);
  rows.push(`"Subject: ${sorted[0]?.subject || 'Assessment'}"`);
  rows.push(`"Total Students: ${sorted.length}"`);
  rows.push(`"Published Date: ${new Date().toLocaleDateString()}"`);
  rows.push('');

  const headers = [
    'Rank',
    'Roll Number',
    'Set',
    'Exam Name',
    'Subject',
    'Marks Obtained',
    'Total Marks',
    'Percentage',
    'Grade',
    'Remarks',
  ];

  for (let q = 1; q <= maxQ; q++) {
    headers.push(`Q${q} Marked`, `Q${q} Score`, `Q${q} Status`);
  }
  headers.push('Evaluation Date');

  rows.push(headers.map(escapeCSV).join(','));

  sorted.forEach((item) => {
    const grade = getGrade(item.percentage);
    const rank = rankMap.get(item.id) || 1;
    const dateStr = new Date(item.scannedAt).toLocaleDateString();

    let remark = 'Needs Improvement';
    if (item.percentage >= 90) remark = 'Outstanding Performance';
    else if (item.percentage >= 75) remark = 'Excellent';
    else if (item.percentage >= 60) remark = 'Good';
    else if (item.percentage >= 45) remark = 'Satisfactory';

    const row = [
      `#${rank}`,
      item.detectedRollNumber || 'N/A',
      item.detectedSet || 'N/A',
      item.answerKeyName,
      item.subject,
      formatMark(item.score),
      formatMark(item.totalMarks || item.totalQuestions),
      `${Math.round(item.percentage)}%`,
      grade,
      remark,
    ];

    const qMap = new Map((item.questionResults || []).map((qr) => [qr.questionNumber, qr]));

    for (let q = 1; q <= maxQ; q++) {
      const qr = qMap.get(q);
      if (qr) {
        const marked = Array.isArray(qr.selected) ? qr.selected.join('+') : qr.selected || '';
        const isBlank = !marked;
        const isPartial = !qr.isCorrect && Number(qr.mark) > 0;
        const qStatus = qr.isCorrect ? '✓ Correct' : isPartial ? '≈ Partial' : isBlank ? '— Blank' : '✗ Incorrect';
        row.push(marked || '—', formatMark(qr.mark), qStatus);
      } else {
        row.push('—', '0', '— Blank');
      }
    }

    row.push(dateStr);
    rows.push(row.map(escapeCSV).join(','));
  });

  return '\uFEFF' + rows.join('\r\n');
}

/** Legacy alias */
export function generateRollWiseCSV(results: ScanResult[], examTitle?: string): string {
  return generateTeacherCSV(results, examTitle);
}

/**
 * Cross-platform CSV & text file downloader.
 */
export async function downloadCSV(csvContent: string, fileName: string = 'omr_results_roll_wise.csv'): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    try {
      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export CSV Results',
          UTI: 'public.comma-separated-values-text',
        });
      }
    } catch (e) {
      console.error('Failed to share CSV on mobile:', e);
    }
  }
}
