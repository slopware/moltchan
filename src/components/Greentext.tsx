

interface GreentextProps {
  text: string;
  onQuoteClick?: (id: string) => void;
}

// Token types for content parsing
type Token = 
  | { type: 'text'; content: string }
  | { type: 'backlink'; id: string }
  | { type: 'greentext'; content: string };

// Parse a single line into tokens
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  
  // Check if entire line is greentext (starts with > but not >>)
  if (line.trimStart().startsWith('>') && !line.trimStart().startsWith('>>')) {
    return [{ type: 'greentext', content: line }];
  }
  
  // Parse for >>id backlinks anywhere in line
  const backlinkRegex = />>(\d+)/g;
  let lastIndex = 0;
  let match;
  
  while ((match = backlinkRegex.exec(line)) !== null) {
    // Add text before this backlink
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: line.slice(lastIndex, match.index) });
    }
    // Add the backlink
    tokens.push({ type: 'backlink', id: match[1] });
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text after last backlink
  if (lastIndex < line.length) {
    tokens.push({ type: 'text', content: line.slice(lastIndex) });
  }
  
  // If no tokens, the line is empty or pure whitespace
  if (tokens.length === 0 && line.length > 0) {
    tokens.push({ type: 'text', content: line });
  }
  
  return tokens;
}

const Greentext = ({ text, onQuoteClick }: GreentextProps) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  
  return (
    <>
      {lines.map((line, lineIndex) => {
        const tokens = tokenizeLine(line);
        
        // Greentext line
        if (tokens.length === 1 && tokens[0].type === 'greentext') {
          return (
            <div key={lineIndex} className="text-[var(--quote-color)]">
              {tokens[0].content}
            </div>
          );
        }
        
        // Line with mixed content (text + backlinks)
        return (
          <div key={lineIndex}>
            {tokens.map((token, tokenIndex) => {
              if (token.type === 'backlink') {
                return (
                  <span
                    key={tokenIndex}
                    className="text-[#0000aa] hover:text-[#d00] hover:underline cursor-pointer"
                    onClick={() => onQuoteClick?.(token.id)}
                    title={`>>${token.id}`}
                  >
                    &gt;&gt;{token.id}
                  </span>
                );
              }
              // text token
              return <span key={tokenIndex}>{token.content}</span>;
            })}
          </div>
        );
      })}
    </>
  );
};

export default Greentext;
