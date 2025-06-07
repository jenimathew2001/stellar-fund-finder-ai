
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

interface ProcessingStatusProps {
  isProcessing: boolean;
  currentItem: string;
  onStartProcessing: () => void;
  totalItems: number;
  data?: FundraiseData[];
  onDataUpdate?: (updatedData: FundraiseData[]) => void;
}

export const ProcessingStatus = ({
  isProcessing,
  currentItem,
  onStartProcessing,
  totalItems,
  data = [],
  onDataUpdate,
}: ProcessingStatusProps) => {
  const [processed, setProcessed] = useState(0);
  const [localIsProcessing, setLocalIsProcessing] = useState(false);
  const [currentProcessingItem, setCurrentProcessingItem] = useState("");
  const { toast } = useToast();

  const startEnrichment = async () => {
    setLocalIsProcessing(true);
    setProcessed(0);
    
    const pendingItems = data.filter(item => item.status === 'pending');
    
    if (pendingItems.length === 0) {
      toast({
        title: "No items to process",
        description: "All items have already been processed",
      });
      setLocalIsProcessing(false);
      return;
    }

    let processedCount = 0;

    for (const item of pendingItems) {
      setCurrentProcessingItem(item.company_name);
      
      try {
        console.log('Processing item:', item.id, item.company_name);
        
        const { data: result, error } = await supabase.functions.invoke('enrich-fundraise-data', {
          body: { recordId: item.id }
        });

        if (error) {
          console.error('Error processing item:', error);
          toast({
            title: "Processing error",
            description: `Failed to process ${item.company_name}: ${error.message}`,
            variant: "destructive",
          });
        } else {
          console.log('Successfully processed:', result);
          processedCount++;
          setProcessed(processedCount);
          
          // Update the local data
          if (onDataUpdate) {
            const updatedData = data.map(dataItem => 
              dataItem.id === item.id 
                ? { ...dataItem, status: 'completed' as const }
                : dataItem
            );
            onDataUpdate(updatedData);
          }
        }
      } catch (error) {
        console.error('Unexpected error:', error);
        toast({
          title: "Unexpected error",
          description: `Failed to process ${item.company_name}`,
          variant: "destructive",
        });
      }
    }

    setLocalIsProcessing(false);
    setCurrentProcessingItem("");
    
    toast({
      title: "Processing complete",
      description: `Successfully processed ${processedCount} of ${pendingItems.length} items`,
    });
  };

  const actuallyProcessing = isProcessing || localIsProcessing;
  const completedCount = data.filter(item => item.status === 'completed').length;
  const errorCount = data.filter(item => item.status === 'error').length;
  const pendingCount = data.filter(item => item.status === 'pending').length;

  return (
    <div className="bg-black/20 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">AI Processing Status</h2>
        
        {!actuallyProcessing ? (
          <Button
            onClick={startEnrichment}
            disabled={pendingCount === 0}
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

      {actuallyProcessing && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">
              Processing: <span className="text-blue-400 font-medium">{currentProcessingItem || currentItem}</span>
            </span>
            <span className="text-gray-300">
              {completedCount} / {totalItems}
            </span>
          </div>
          
          <Progress 
            value={(completedCount / totalItems) * 100} 
            className="h-2 bg-gray-800"
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <CheckCircle className="h-8 w-8 text-green-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">{completedCount}</div>
          <div className="text-sm text-gray-400">Completed</div>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <RotateCcw className="h-8 w-8 text-blue-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">{actuallyProcessing ? 1 : 0}</div>
          <div className="text-sm text-gray-400">In Progress</div>
        </div>
        
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <AlertCircle className="h-8 w-8 text-yellow-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-white">{pendingCount + errorCount}</div>
          <div className="text-sm text-gray-400">Pending</div>
        </div>
      </div>
    </div>
  );
};
