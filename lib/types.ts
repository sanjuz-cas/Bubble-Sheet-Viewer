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
  detectedSet?: string;
  detectedRollNumber?: string;
}

export interface QuestionResult {
  questionNumber: number;
  selected: string[];
  correct: string[];
  isCorrect: boolean;
  mark: number;
  correctSelected: number;
  wrongSelected: number;
}

export function calculateQuestionMark(
  correct: string[],
  selected: string[],
  totalMarks: number,
): { mark: number; correctSelected: number; wrongSelected: number; isExactMatch: boolean } {
  const normalizedCorrect = [...correct].sort();
  const normalizedSelected = [...selected].sort();
  const correctSelected = selected.filter(answer => correct.includes(answer)).length;
  const wrongSelected = selected.filter(answer => !correct.includes(answer)).length;
  const isExactMatch = normalizedCorrect.length === normalizedSelected.length
    && normalizedCorrect.every((answer, index) => answer === normalizedSelected[index]);

  if (correctSelected === 0 || correct.length === 0) {
    return { mark: 0, correctSelected, wrongSelected, isExactMatch };
  }

  return {
    mark: (correctSelected * totalMarks) / (correct.length * (2 ** wrongSelected)),
    correctSelected,
    wrongSelected,
    isExactMatch,
  };
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
