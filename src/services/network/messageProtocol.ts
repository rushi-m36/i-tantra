import { Message } from "../../types/communication";

// Message framing: each message is JSON followed by newline
const DELIMITER = "\n";

export class MessageProtocol {
  private buffer: string = "";

  /**
   * Encode a message with delimiter for TCP transmission
   */
  static encode(message: Message): string {
    return JSON.stringify(message) + DELIMITER;
  }

  /**
   * Process incoming data and extract complete messages
   * Returns array of parsed messages and remaining buffer
   */
  processData(data: string): { messages: Message[]; remainingBuffer: string } {
    this.buffer += data;
    const messages: Message[] = [];

    let currentIndex = 0;
    while (currentIndex < this.buffer.length) {
      const delimiterIndex = this.buffer.indexOf(DELIMITER, currentIndex);

      if (delimiterIndex === -1) {
        // No complete message found
        this.buffer = this.buffer.substring(currentIndex);
        break;
      }

      // Extract message
      const messageStr = this.buffer.substring(currentIndex, delimiterIndex);
      try {
        const message = JSON.parse(messageStr) as Message;
        messages.push(message);
      } catch (e) {
        console.error("Failed to parse message:", messageStr, e);
      }

      currentIndex = delimiterIndex + DELIMITER.length;
    }

    this.buffer = this.buffer.substring(currentIndex);
    return { messages, remainingBuffer: this.buffer };
  }

  clearBuffer(): void {
    this.buffer = "";
  }
}
