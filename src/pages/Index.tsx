
import { useState } from "react";
import { FileUpload } from "@/components/FileUpload";
import { DataTable } from "@/components/DataTable";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { SpaceBackground } from "@/components/SpaceBackground";
import { Rocket, Database, Brain, Sparkles } from "lucide-react";

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
      
      {/* Header */}
      <div className="relative z-10 container mx-auto px-4 py-8">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Rocket className="h-12 w-12 text-blue-400 animate-pulse" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Space Fundraise Intelligence
            </h1>
            <Sparkles className="h-12 w-12 text-pink-400 animate-pulse" />
          </div>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Upload your space company fundraising data and let AI enrich it with press releases and investor contacts
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-black/20 backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 text-center">
            <Database className="h-12 w-12 text-blue-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Data Upload</h3>
            <p className="text-gray-300">Support for CSV and XLSX files with smart parsing</p>
          </div>
          <div className="bg-black/20 backdrop-blur-sm border border-purple-500/20 rounded-xl p-6 text-center">
            <Brain className="h-12 w-12 text-purple-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">AI Research</h3>
            <p className="text-gray-300">ChatGPT finds relevant press releases automatically</p>
          </div>
          <div className="bg-black/20 backdrop-blur-sm border border-pink-500/20 rounded-xl p-6 text-center">
            <Sparkles className="h-12 w-12 text-pink-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Contact Extraction</h3>
            <p className="text-gray-300">Extract investor names and contacts from articles</p>
          </div>
        </div>

        {/* Main Content */}
        {data.length === 0 ? (
          <FileUpload onFileUpload={handleFileUpload} />
        ) : (
          <div className="space-y-8">
            <ProcessingStatus 
              isProcessing={isProcessing}
              currentItem={currentProcessing}
              onStartProcessing={startProcessing}
              totalItems={data.length}
            />
            <DataTable data={data} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
