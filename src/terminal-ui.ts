// Terminal UI Enhancements
import { marked } from 'marked';
import hljs from 'highlight.js';

// Configure marked for basic options (syntax highlighting will be done separately)
marked.setOptions({
  breaks: true,
  gfm: true
});

export interface TerminalLine {
  content: string;
  type: 'info' | 'error' | 'stderr' | 'stdout' | 'result' | 'assistant' | 'execution' | 'code' | 'markdown';
  timestamp?: Date;
}

export class TerminalRenderer {
  private container: HTMLElement;
  private lastLine: HTMLElement | null = null;
  private commandHistory: string[] = [];
  private historyIndex: number = -1;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Render a terminal line with appropriate styling and formatting
   */
  renderLine(line: TerminalLine, append: boolean = false): HTMLElement {
    if (append && this.lastLine) {
      // Append to existing line for streaming
      this.lastLine.textContent += line.content;
      this.scrollToBottom();
      return this.lastLine;
    }

    // Create new line element
    const lineElement = document.createElement('div');
    lineElement.className = 'terminal-line';

    // Handle different content types
    if (line.type === 'markdown') {
      // Render markdown with syntax highlighting
      this.renderMarkdown(lineElement, line.content);
    } else if (line.type === 'code') {
      // Render code block with syntax highlighting and copy button
      this.renderCodeBlock(lineElement, line.content);
    } else {
      // Plain text with color styling
      this.applyTypeStyle(lineElement, line.type);
      lineElement.textContent = line.content;
    }

    this.container.appendChild(lineElement);
    this.lastLine = lineElement;
    this.scrollToBottom();

    return lineElement;
  }

  /**
   * Render markdown content
   */
  private renderMarkdown(element: HTMLElement, content: string): void {
    try {
      const html = marked.parse(content) as string;
      element.innerHTML = html;
      element.classList.add('markdown-content');

      // Add copy buttons to code blocks
      const codeBlocks = element.querySelectorAll('pre code');
      codeBlocks.forEach(block => {
        this.addCopyButton(block.parentElement as HTMLElement);
      });
    } catch (error) {
      console.error('Markdown render error:', error);
      element.textContent = content;
    }
  }

  /**
   * Render a code block with syntax highlighting
   */
  private renderCodeBlock(element: HTMLElement, code: string, language: string = 'python'): void {
    const pre = document.createElement('pre');
    const codeElement = document.createElement('code');
    codeElement.className = `language-${language}`;

    try {
      if (hljs.getLanguage(language)) {
        codeElement.innerHTML = hljs.highlight(code, { language }).value;
      } else {
        codeElement.innerHTML = hljs.highlightAuto(code).value;
      }
    } catch (err) {
      console.error('Syntax highlight error:', err);
      codeElement.textContent = code;
    }

    pre.appendChild(codeElement);
    element.appendChild(pre);
    element.classList.add('code-block');

    // Add copy button
    this.addCopyButton(pre);
  }

  /**
   * Add a copy button to a code block
   */
  private addCopyButton(preElement: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    // Move pre into wrapper
    preElement.parentNode?.insertBefore(wrapper, preElement);
    wrapper.appendChild(preElement);

    // Create copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = '📋 Copy';
    copyBtn.title = 'Copy to clipboard';

    copyBtn.addEventListener('click', async () => {
      const codeElement = preElement.querySelector('code');
      if (codeElement) {
        try {
          await navigator.clipboard.writeText(codeElement.textContent || '');
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => {
            copyBtn.textContent = '📋 Copy';
          }, 2000);
        } catch (err) {
          console.error('Copy failed:', err);
          copyBtn.textContent = '✗ Failed';
          setTimeout(() => {
            copyBtn.textContent = '📋 Copy';
          }, 2000);
        }
      }
    });

    wrapper.appendChild(copyBtn);
  }

  /**
   * Apply type-specific styling to a line element
   */
  private applyTypeStyle(element: HTMLElement, type: string): void {
    const colorMap: Record<string, string> = {
      error: '#f48771',
      stderr: '#f48771',
      result: '#4ec9b0',
      stdout: '#d4d4d4',
      assistant: '#9cdcfe',
      execution: '#ce9178',
      info: '#d4d4d4'
    };

    const color = colorMap[type] || '#d4d4d4';
    element.style.color = color;
  }

  /**
   * Scroll terminal to bottom
   */
  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Clear terminal output
   */
  clear(): void {
    this.container.innerHTML = '';
    this.lastLine = null;
  }

  /**
   * Add command to history
   */
  addToHistory(command: string): void {
    if (command.trim() && (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== command)) {
      this.commandHistory.push(command);
    }
    this.historyIndex = this.commandHistory.length;
  }

  /**
   * Navigate command history - returns the command or null
   */
  navigateHistory(direction: 'up' | 'down'): string | null {
    if (this.commandHistory.length === 0) return null;

    if (direction === 'up') {
      if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else {
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = this.commandHistory.length;
        return '';
      }
    }

    return this.commandHistory[this.historyIndex] || null;
  }

  /**
   * Get command history
   */
  getHistory(): string[] {
    return [...this.commandHistory];
  }

  /**
   * Reset history index
   */
  resetHistoryIndex(): void {
    this.historyIndex = this.commandHistory.length;
  }
}

/**
 * Detect if content is markdown or code
 */
export function detectContentType(content: string): 'markdown' | 'code' | 'plain' {
  // Check for markdown indicators
  if (
    content.includes('```') ||
    content.match(/^#+\s/) ||
    content.includes('**') ||
    content.includes('__') ||
    content.match(/^\*\s/) ||
    content.match(/^\-\s/) ||
    content.match(/^\d+\.\s/)
  ) {
    return 'markdown';
  }

  // Check for code indicators (Python-specific)
  if (
    content.match(/^(import|from|def|class|if|for|while|try|except|with)\s/) ||
    content.includes('print(') ||
    content.includes('return ')
  ) {
    return 'code';
  }

  return 'plain';
}
