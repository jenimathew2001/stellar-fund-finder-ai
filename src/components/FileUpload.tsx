import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface FundraiseData {
  id: string;
  company_name: string;
  date_raised: string;
  amount_raised: string;
  investors: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

interface FileUploadProps {
  onFileUpload: (data: FundraiseData[]) => void;
}

export const FileUpload = ({ onFileUpload }: FileUploadProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const saveToSupabase = async (processedData: Omit<FundraiseData, 'id'>[]) => {
    try {
      const dataToInsert = processedData.map(row => ({
        company_name: row.company_name,
        date_raised: row.date_raised,
        amount_raised: row.amount_raised,
        investors: row.investors,
        status: 'pending' as const
      }));

      const { data, error } = await supabase
        .from('fundraise_data')
        .insert(dataToInsert)
        .select();

      if (error) {
        console.error('Supabase error:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Error saving to database:', error);
      throw error;
    }
  };

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    try {
      let processedData: Omit<FundraiseData, 'id'>[] = [];

      if (fileExtension === 'csv') {
        await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            complete: (results) => {
              try {
                processedData = results.data
                  .filter((row: any) => row.company_name || row['Company Name'])
                  .map((row: any) => ({
                    company_name: row.company_name || row['Company Name'] || '',
                    date_raised: row.date_raised || row['Date Raised'] || '',
                    amount_raised: row.amount_raised || row['Amount Raised'] || '',
                    investors: row.investors || row['Investors'] || '',
                    status: 'pending' as const,
                  }));

                if (processedData.length === 0) {
                  throw new Error('No valid data found in CSV');
                }
                resolve(processedData);
              } catch (error) {
                reject(error);
              }
            },
            error: (error) => {
              reject(new Error(`CSV parsing error: ${error.message}`));
            }
          });
        });
      } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        processedData = jsonData
          .filter((row: any) => row.company_name || row['Company Name'])
          .map((row: any) => ({
            company_name: row.company_name || row['Company Name'] || '',
            date_raised: row.date_raised || row['Date Raised'] || '',
            amount_raised: row.amount_raised || row['Amount Raised'] || '',
            investors: row.investors || row['Investors'] || '',
            status: 'pending' as const,
          }));

        if (processedData.length === 0) {
          throw new Error('No valid data found in Excel file');
        }
      } else {
        throw new Error('Unsupported file type. Please upload a CSV or XLSX file.');
      }

      // Save to Supabase
      const savedData = await saveToSupabase(processedData);
      
      // Convert saved data to match the expected interface
      const dataWithIds: FundraiseData[] = savedData.map(item => ({
        id: item.id,
        company_name: item.company_name,
        date_raised: item.date_raised,
        amount_raised: item.amount_raised,
        investors: item.investors,
        status: item.status as 'pending' | 'processing' | 'completed' | 'error'
      }));

      onFileUpload(dataWithIds);
      toast({
        title: "File uploaded successfully!",
        description: `Processed and saved ${savedData.length} records to database`,
      });

    } catch (error) {
      console.error('File processing error:', error);
      toast({
        title: "Error processing file",
        description: error instanceof Error ? error.message : "Please check your file format and try again",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onFileUpload, toast]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const file = files[0];
    
    if (file) {
      processFile(file);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300 backdrop-blur-sm ${
          isDragging
            ? "border-blue-400 bg-blue-500/10"
            : "border-gray-600 bg-black/20 hover:border-blue-500 hover:bg-blue-500/5"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isProcessing ? (
          <div className="space-y-4">
            <div className="animate-spin mx-auto h-12 w-12 border-4 border-blue-400 border-t-transparent rounded-full"></div>
            <p className="text-gray-300">Processing and saving your file...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="relative">
                <Upload className="h-16 w-16 text-blue-400 mx-auto animate-bounce" />
                <FileSpreadsheet className="h-8 w-8 text-green-400 absolute -bottom-2 -right-2" />
              </div>
            </div>
            
            <div>
              <h3 className="text-2xl font-semibold text-white mb-2">
                Upload Your Fundraise Data
              </h3>
              <p className="text-gray-300 mb-4">
                Drag and drop your CSV or XLSX file here, or click to browse
              </p>
              
              <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-6">
                <AlertCircle className="h-4 w-4" />
                <span>Supports CSV and XLSX files</span>
              </div>
            </div>

            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileInput}
              className="hidden"
              id="file-upload"
            />
            
            <Button
              asChild
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0"
            >
              <label htmlFor="file-upload" className="cursor-pointer">
                Choose File
              </label>
            </Button>
          </div>
        )}
      </div>

      <div className="mt-8 bg-black/20 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-white mb-3">Expected CSV/XLSX Format:</h4>
        <div className="text-sm text-gray-300 space-y-2">
          <p><strong>Required columns:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Company Name</li>
            <li>Date Raised</li>
            <li>Amount Raised</li>
            <li>Investors</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
