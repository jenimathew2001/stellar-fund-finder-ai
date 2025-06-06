
import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { DataTable } from "@/components/DataTable";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { SpaceBackground } from "@/components/SpaceBackground";
import { Rocket, Database, Brain, Sparkles, Orbit } from "lucide-react";

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
  press_url_1?: string;
  press_url_2?: string;
  press_url_3?: string;
  investor_contacts?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

const Index = () => {
  const [data, setData] = useState<FundraiseData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentProcessing, setCurrentProcessing] = useState<string>("");

  const handleFileUpload = (uploadedData: FundraiseData[]) => {
    setData(uploadedData);
  };

  const startProcessing = () => {
    setIsProcessing(true);
    // This will be implemented with the actual processing logic
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <SpaceBackground />
      
      {/* Header with enhanced 3D effects */}
      <div className="relative z-10 container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-6 perspective-1000">
            <div className="animate-bounce">
              <Rocket className="h-16 w-16 text-blue-400 drop-shadow-2xl transform hover:scale-110 transition-transform duration-300" />
            </div>
            <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent drop-shadow-2xl transform hover:scale-105 transition-transform duration-300">
              Space Fundraise Intelligence
            </h1>
            <div className="animate-pulse">
              <Sparkles className="h-16 w-16 text-pink-400 drop-shadow-2xl transform hover:scale-110 transition-transform duration-300" />
            </div>
          </div>
          <p className="text-xl text-gray-200 max-w-4xl mx-auto leading-relaxed drop-shadow-lg">
            Upload your space company fundraising data and let AI enrich it with press releases and investor contacts
          </p>
          <div className="mt-6">
            <Orbit className="h-8 w-8 text-purple-400 mx-auto animate-spin" />
          </div>
        </div>

        {/* Enhanced Features with 3D cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          <div className="group bg-black/30 backdrop-blur-lg border border-blue-500/30 rounded-2xl p-8 text-center transform hover:scale-105 hover:rotate-1 transition-all duration-300 shadow-2xl hover:shadow-blue-500/25">
            <div className="transform group-hover:scale-110 transition-transform duration-300">
              <Database className="h-16 w-16 text-blue-400 mx-auto mb-6 drop-shadow-xl" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-4">Data Upload</h3>
            <p className="text-gray-300 leading-relaxed">Support for CSV and XLSX files with smart parsing and validation</p>
          </div>
          
          <div className="group bg-black/30 backdrop-blur-lg border border-purple-500/30 rounded-2xl p-8 text-center transform hover:scale-105 hover:-rotate-1 transition-all duration-300 shadow-2xl hover:shadow-purple-500/25">
            <div className="transform group-hover:scale-110 transition-transform duration-300">
              <Brain className="h-16 w-16 text-purple-400 mx-auto mb-6 drop-shadow-xl" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-4">AI Research</h3>
            <p className="text-gray-300 leading-relaxed">ChatGPT finds relevant press releases automatically with precision</p>
          </div>
          
          <div className="group bg-black/30 backdrop-blur-lg border border-pink-500/30 rounded-2xl p-8 text-center transform hover:scale-105 hover:rotate-1 transition-all duration-300 shadow-2xl hover:shadow-pink-500/25">
            <div className="transform group-hover:scale-110 transition-transform duration-300">
              <Sparkles className="h-16 w-16 text-pink-400 mx-auto mb-6 drop-shadow-xl" />
            </div>
            <h3 className="text-2xl font-semibold text-white mb-4">Contact Extraction</h3>
            <p className="text-gray-300 leading-relaxed">Extract investor names and contacts from articles intelligently</p>
          </div>
        </div>

        {/* Main Content with enhanced styling */}
        {data.length === 0 ? (
          <div className="transform hover:scale-[1.02] transition-transform duration-300">
            <FileUpload onFileUpload={handleFileUpload} />
          </div>
        ) : (
          <div className="space-y-8">
            <div className="transform hover:scale-[1.01] transition-transform duration-300">
              <ProcessingStatus 
                isProcessing={isProcessing}
                currentItem={currentProcessing}
                onStartProcessing={startProcessing}
                totalItems={data.length}
              />
            </div>
            <div className="transform hover:scale-[1.01] transition-transform duration-300">
              <DataTable data={data} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
