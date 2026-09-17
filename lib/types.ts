export interface AnswerKey {
  id: string;
  name: string;
  subject: string;
  totalQuestions: number;
  optionsPerQuestion: number;
  marksPerQuestion: number;
  /** Accepted option labels for each question, e.g. [["A", "C"], ["B"]]. */
  answers: string[][];
  setAnswers?: Record<string, string[][]>;
  createdAt: string;
}

export interface ScanResult {
  id: string;
  answerKeyId: string;
  answerKeyName: string;
  subject: string;
  detectedAnswers: string[][];
  correctAnswers: string[][];
  score: number;
  totalQuestions: number;
  totalMarks: number;
  percentage: number;
  questionResults: QuestionResult[];
  scannedAt: string;
  imageUri?: string;
  annotatedImage?: string;
  detectedSet?: string;
  detectedRollNumber?: string;
}

export interface QuestionResult {
  questionNumber: number;
  selected: string[];
  correct: string[];
  isCorrect: boolean;
  mark: number;
  maxMarks?: number;
  baseScore?: number;
  penalty?: number;
  correctSelected: number;
  wrongSelected: number;
  totalSelected?: number;
}

/**
 * Multi-Set Partial Marking Formula
 * Variables:
/**
 * Marking Scheme Specification — Multiple Correct Answer Questions
 *
 * Context:
 *   Each question has multiple options (a, b, c, d, ...), of which n are correct.
 *   The question carries a total weight of T marks. A student can select any number of options.
 *
 * Definitions:
 *   - n: Number of correct answers for the question (correct.length)
 *   - T: Total marks allotted to the question (marksPerQuestion)
 *   - m: Number of correct answers the student selected (0 <= m <= n)
 *   - P: Number of wrong (incorrect) answers the student selected
 *   - S: Base score if only correct answers were selected = (m * T) / n
 *
 * Scoring Rules:
 *   1. No correct answer selected (m = 0): Mark = 0, regardless of P.
 *   2. At least one correct answer selected (m >= 1): Every wrong answer selected halves the current score.
 *      Mark = S * (1 / 2)^P = (m * T) / (n * 2^P)
 */
export function calculateQuestionMark(
  correct: string[],
  selected: string[],
  T: number = 3.0,
  optionsCount: number = 6,
): {
  mark: number;
  baseScore: number;
  penalty: number;
  m: number;
  P: number;
  n: number;
  T: number;
  correctSelected: number;
  wrongSelected: number;
  totalSelected: number;
  isExactMatch: boolean;
  isPartialMatch: boolean;
  isBlank: boolean;
  status: 'EXACT' | 'PARTIAL' | 'WRONG' | 'BLANK';
  details: string;
} {
  const normalizedCorrect = Array.isArray(correct) ? correct.filter(Boolean).sort() : [];
  const normalizedSelected = Array.isArray(selected) ? selected.filter(Boolean).sort() : [];
  const n = normalizedCorrect.length;
  const m = normalizedSelected.filter(answer => normalizedCorrect.includes(answer)).length;
  const P = normalizedSelected.filter(answer => !normalizedCorrect.includes(answer)).length;
  const totalSelected = normalizedSelected.length;
  const maxM = Number(T) > 0 ? Number(T) : 3.0;

  const isExactMatch = n > 0 && m === n && P === 0;
  const isBlank = totalSelected === 0;

  // Rule 1: No Correct Selected (m == 0) -> Mark = 0, regardless of P
  if (m === 0 || n === 0) {
    return {
      mark: 0,
      baseScore: 0,
      penalty: 0,
      m,
      P,
      n,
      T: maxM,
      correctSelected: m,
      wrongSelected: P,
      totalSelected,
      isExactMatch: false,
      isPartialMatch: false,
      isBlank,
      status: isBlank ? 'BLANK' : 'WRONG',
      details: isBlank ? 'No answer marked' : `0/${n} correct picked, ${P} wrong`,
    };
  }

  // Rule 2: At least one correct answer selected (m >= 1):
  // Every wrong answer selected halves the current score:
  // Mark = S * (1/2)^P = (m * T) / (n * 2^P)
  const baseScore = (m * maxM) / n;
  const mark = baseScore / (2 ** P);
  const penalty = baseScore - mark;
  const isPartialMatch = !isExactMatch && mark > 0;

  const status = isExactMatch ? 'EXACT' : 'PARTIAL';
  const details = isExactMatch
    ? `Full credit: ${n}/${n} correct picked`
    : `${m}/${n} correct picked, ${P} wrong (Halved ${P}x: ${formatMarkVal(baseScore)} -> ${formatMarkVal(mark)})`;

  return {
    mark,
    baseScore,
    penalty,
    m,
    P,
    n,
    T: maxM,
    correctSelected: m,
    wrongSelected: P,
    totalSelected,
    isExactMatch,
    isPartialMatch,
    isBlank: false,
    status,
    details,
  };
}

export function formatMarkVal(val: number): string {
  const num = Number(val);
  if (isNaN(num)) return '0';
  if (Number.isInteger(num)) return num.toString();
  return parseFloat(num.toFixed(3)).toString();
}

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

export function getGrade(percentage: number): Grade {
  if (percentage >= 95) return 'A+';
  if (percentage >= 85) return 'A';
  if (percentage >= 80) return 'B+';
  if (percentage >= 70) return 'B';
  if (percentage >= 65) return 'C+';
  if (percentage >= 55) return 'C';
  if (percentage >= 45) return 'D';
  return 'F';
}

export function getGradeColor(grade: Grade): string {
  switch (grade) {
    case 'A+': return '#7BC67E';
    case 'A': return '#A8E6CF';
    case 'B+': return '#B5D8F7';
    case 'B': return '#DCD6F7';
    case 'C+': return '#FFD166';
    case 'C': return '#FFDAB9';
    case 'D': return '#FFB7B2';
    case 'F': return '#FF6B6B';
  }
}
