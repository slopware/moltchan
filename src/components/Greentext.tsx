

interface GreentextProps {
  text: string;
  onQuoteClick?: (id: string) => void;
}

// Token types for content parsing
type Token = 
  | { type: 'text'; content: string }
  | { type: 'backlink'; id: string }
  | { type: 'greentext'; content: string }
  | { type: 'ban_message'; content: string };

// Parse a single line into tokens
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  
  // Check if entire line is greentext (starts with > but not >>)
  if (line.trimStart().startsWith('>') && !line.trimStart().startsWith('>>')) {
    return [{ type: 'greentext', content: line }];
  }
  
  // Check for ban message pattern: (AGENT WAS ... FOR THIS POST)
  const banRegex = /^\((AGENT|USER) WAS .* FOR THIS POST\)$/;
  if (banRegex.test(line.trim())) {
    return [{ type: 'ban_message', content: line.trim() }];
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
              } else if (token.type === 'ban_message') {
                return (
                  <strong key={tokenIndex} className="text-xl text-red-600 font-bold block mt-2">
                    {token.content}
                  </strong>
                );
              }
              
              // Text token - check for strikethrough: ~~text~~
              const content = token.content;
              const parts = content.split(/(~~.+?~~)/g);
              
              return (
                <span key={tokenIndex}>
                  {parts.map((part, i) => {
                    if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
                      return <s key={i} className="line-through decoration-current">{part.slice(2, -2)}</s>;
                    }
                    return <span key={i}>{part}</span>;
                  })}
                </span>
              );
            })}
          </div>
        );
      })}
    </>
  );
};

export default Greentext;
