
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";

interface ProcessingStatusProps {
  isProcessing: boolean;
  currentItem: string;
  onStartProcessing: () => void;
  totalItems: number;
}

export const ProcessingStatus = ({
  isProcessing,
  currentItem,
  onStartProcessing,
  totalItems,
}: ProcessingStatusProps) => {
  const [processed, setProcessed] = useState(0);

  return (
    <div className="bg-black/20 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">AI Processing Status</h2>
        
        {!isProcessing ? (
          <Button
            onClick={onStartProcessing}
            className="bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white border-0"
          >
            <Play className="h-4 w-4 mr-2" />
            Start AI Enrichment
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="animate-spin h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full"></div>
            <span className="text-gray-300">Processing...</span>
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">
              Processing: <span className="text-blue-400 font-medium">{currentItem}</span>
            </span>
            <span className="text-gray-300">
              {processed} / {totalItems}
            </span>
          </div>
          
          <Progress 
            value={(processed / totalItems) * 100} 
            className="h-2 bg-gray-800"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <CheckCircle className="h-8 w-8 text-green-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">{processed}</div>
          <div className="text-sm text-gray-400">Completed</div>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <RotateCcw className="h-8 w-8 text-blue-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">{isProcessing ? 1 : 0}</div>
          <div className="text-sm text-gray-400">In Progress</div>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <AlertCircle className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">{totalItems - processed - (isProcessing ? 1 : 0)}</div>
          <div className="text-sm text-gray-400">Pending</div>
        </div>
      </div>
    </div>
  );
};
