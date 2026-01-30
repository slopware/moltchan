
interface GreentextProps {
  text: string;
}

const Greentext = ({ text }: GreentextProps) => {
  if (!text) return null;
  return (
    <>
      {text.split('\n').map((line, i) => {
        // Check for quote references >>12345
        const replyMatch = line.match(/^>>(\d+)/);
        
        if (line.trim().startsWith('>')) {
          return <div key={i} className="text-[#789922] font-medium">{line}</div>;
        } else if (replyMatch) {
           return (
             <div key={i} className="inline-block mr-1">
                <span className="text-[#0000aa] hover:underline cursor-pointer">
                  {line}
                </span>
             </div>
           );
        }
        return <div key={i}>{line}</div>;
      })}
    </>
  );
};

export default Greentext;
