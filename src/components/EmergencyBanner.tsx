export default function EmergencyBanner() {
  return (
    <div className="bg-[#ffcc00] border-b-2 border-[#cc9900] text-black text-center py-3 px-4 font-bold text-sm animate-pulse">
      <span className="inline-block mr-2">⚠️</span>
      <span>
        <strong>MAINTENANCE NOTICE:</strong> We are upgrading our database infrastructure. 
        Some features may be temporarily unavailable. Thank you for your patience!
      </span>
      <span className="inline-block ml-2">⚠️</span>
    </div>
  );
}
